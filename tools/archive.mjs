// Controle en archief voor de wekelijkse beoordeling.
//
// Leest public/data.json (eigendom van de wekelijkse Claude-taak) en doet twee dingen:
//
//   1. Controleren. Elk land heeft naast de tekstregels in `incidents` een even lange
//      lijst `events` met dezelfde incidenten in gestructureerde vorm, en eventueel
//      `forecasts`: toetsbare verwachtingen in de woorden van de PHIA-kansschaal.
//      Fouten stoppen het script met exitcode 1, zodat er niet gedeployd wordt.
//   2. Archiveren. Incidenten en verwachtingen gaan naar archive/, dat alleen
//      aangroeit. data.json wordt elke week overschreven; het archief bewaart wat
//      er ooit in stond, en een gepubliceerde verwachting verandert daar nooit meer.
//
// Het script schrijft nooit in data.json zelf.
//
// Gebruik: node tools/archive.mjs            (controleren en archiveren)
//          node tools/archive.mjs --check    (alleen controleren)

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORTEL = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (naam) => { const i = process.argv.indexOf(naam); return i > 0 ? process.argv[i + 1] : null; };
const DATA = arg('--data') || join(WORTEL, 'public', 'data.json');       // --data/--archive: alleen om te testen
const ARCHIEF_MAP = arg('--archive') || join(WORTEL, 'archive');
const INC_ARCHIEF = join(ARCHIEF_MAP, 'incidents.json');
const VW_ARCHIEF = join(ARCHIEF_MAP, 'forecasts.json');
const ALLEEN_CHECK = process.argv.includes('--check');

// Vaste woordenlijsten. Wijzig ze alleen samen met de SKILL.md van de taak
// daily-intel-dashboard-update en de Method-tab in public/index.html.
export const TYPES = [
  'airstrike', 'drone-strike', 'missile-strike', 'shelling', 'ground-clash',
  'bombing', 'armed-attack', 'maritime', 'cyber', 'unrest', 'political',
  'diplomatic', 'military-activity', 'humanitarian', 'other',
];
// PHIA-kansschaal (UK Professional Head of Intelligence Assessment), zoals in Intel Academy § 10.3.
export const PHIA = ['remote chance', 'highly unlikely', 'unlikely', 'realistic possibility',
  'likely', 'highly likely', 'almost certain'];
const MIN_DAGEN = 14, MAX_DAGEN = 92;   // horizon van een verwachting na `generated`

const fouten = [], waarschuwingen = [];
const fout = (m) => fouten.push(m), let_op = (m) => waarschuwingen.push(m);
const lees = (p, d) => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : d;
const isoDag = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const dag = (t) => new Date(t).toISOString().slice(0, 10);
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const gen = Date.parse(data.generated + ' UTC');
if (isNaN(gen)) { console.error('data.json: "generated" is geen datum: ' + data.generated); process.exit(1); }
const cyclus = dag(gen);
// Overgang: beoordelingen van vóór 12 november 2026 hebben nog geen events. Zo'n data.json
// slaan we over in plaats van te weigeren, zodat een handmatige deploy blijft werken.
if (!(data.regions || []).some((r) => (r.countries || []).some((c) => c.events || c.forecasts))) {
  console.log(`data.json (${cyclus}) heeft nog de oude indeling zonder events; niets te controleren of te archiveren.`);
  process.exit(0);
}
const vwArchief = lees(VW_ARCHIEF, { updated: null, forecasts: {} });

const ids = new Set();
let nEvents = 0, nVw = 0;

for (const r of data.regions || []) {
  for (const c of r.countries || []) {
    const waar = c.name;
    const inc = c.incidents || [];
    const ev = c.events;

    // --- incidenten -------------------------------------------------------
    if (!Array.isArray(ev)) fout(`${waar}: "events" ontbreekt (één object per regel in "incidents")`);
    else if (ev.length !== inc.length) fout(`${waar}: ${inc.length} incidenten maar ${ev.length} events; de lijsten horen even lang te zijn, in dezelfde volgorde`);
    else ev.forEach((e, i) => {
      const w = `${waar} event ${i + 1}`;
      nEvents++;
      if (e.date !== null && !isoDag(e.date)) fout(`${w}: date "${e.date}" is geen JJJJ-MM-DD (of null bij "Ongoing")`);
      if (isoDag(e.date) && Date.parse(e.date) > gen + 86400000) fout(`${w}: date ${e.date} ligt na de beoordelingsdatum`);
      if (isoDag(e.date) && Date.parse(e.date) < gen - 21 * 86400000) let_op(`${w}: date ${e.date} ligt meer dan drie weken voor de beoordelingsdatum`);
      if (!e.place || typeof e.place !== 'string') fout(`${w}: "place" ontbreekt`);
      if (!TYPES.includes(e.type)) fout(`${w}: type "${e.type}" staat niet in de lijst (${TYPES.join(', ')})`);
      if (!e.actor || typeof e.actor !== 'string') fout(`${w}: "actor" ontbreekt (gebruik "unknown" als die niet bekend is)`);
      if (e.killed != null && !(Number.isInteger(e.killed) && e.killed >= 0)) fout(`${w}: "killed" moet een heel getal ≥ 0 zijn`);
      const heeftLat = e.lat != null, heeftLng = e.lng != null;
      if (heeftLat !== heeftLng) fout(`${w}: lat en lng horen samen`);
      if (heeftLat && !(Math.abs(e.lat) <= 90 && Math.abs(e.lng) <= 180)) fout(`${w}: coördinaten buiten bereik`);
    });

    // --- verwachtingen ----------------------------------------------------
    const vw = c.forecasts || [];
    if (!Array.isArray(vw)) { fout(`${waar}: "forecasts" moet een lijst zijn`); continue; }
    for (const f of vw) {
      const w = `${waar} forecast ${f.id || '(zonder id)'}`;
      nVw++;
      if (!f.id || !/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+-\d+$/.test(f.id)) fout(`${w}: id hoort "JJJJ-MM-DD-land-n" te zijn, bijv. "2026-11-12-ukraine-1"`);
      if (ids.has(f.id)) fout(`${w}: id komt dubbel voor`);
      ids.add(f.id);
      if (!isoDag(f.made)) fout(`${w}: "made" ontbreekt of is geen JJJJ-MM-DD`);
      if (f.id && f.made && !f.id.startsWith(f.made)) fout(`${w}: id begint niet met de datum uit "made"`);
      if (!PHIA.includes(f.prob)) fout(`${w}: prob "${f.prob}" is geen PHIA-term (${PHIA.join(', ')})`);
      if (!f.statement || f.statement.length < 25) fout(`${w}: "statement" ontbreekt of is te kort`);
      if (!f.resolution || f.resolution.length < 25) fout(`${w}: "resolution" ontbreekt: wanneer is de verwachting uitgekomen, en volgens welke bron?`);
      if (!isoDag(f.by)) fout(`${w}: "by" is geen JJJJ-MM-DD`);
      else if (isoDag(f.made)) {
        const dagen = (Date.parse(f.by) - Date.parse(f.made)) / 86400000;
        if (dagen < MIN_DAGEN || dagen > MAX_DAGEN) fout(`${w}: horizon ${dagen} dagen; houd ${MIN_DAGEN}–${MAX_DAGEN} dagen aan`);
        if (Date.parse(f.by) < gen) fout(`${w}: "by" (${f.by}) is al verstreken; haal de verwachting uit data.json (het archief bewaart hem)`);
      }
      if (f.supersedes && !vwArchief.forecasts[f.supersedes] && !vw.some((x) => x.id === f.supersedes))
        fout(`${w}: supersedes "${f.supersedes}" bestaat niet`);

      // Onveranderlijk: een gepubliceerde verwachting wordt nooit herschreven.
      const oud = vwArchief.forecasts[f.id];
      if (oud) for (const k of ['statement', 'prob', 'by', 'resolution', 'made'])
        if (oud[k] !== f[k]) fout(`${w}: "${k}" wijkt af van de gepubliceerde versie. Een bijgestelde inschatting is een nieuwe verwachting met "supersedes": "${f.id}".`);
      if (oud && oud.country !== waar) fout(`${w}: stond eerder bij ${oud.country}`);
    }
  }
}

// Open verwachtingen uit eerdere weken die zonder opvolger uit data.json zijn verdwenen.
const opgevolgd = new Set();
for (const r of data.regions || []) for (const c of r.countries || []) for (const f of c.forecasts || []) if (f.supersedes) opgevolgd.add(f.supersedes);
for (const [id, f] of Object.entries(vwArchief.forecasts)) {
  if (Date.parse(f.by) >= gen && !ids.has(id) && !opgevolgd.has(id) && !f.supersededBy)
    let_op(`forecast ${id} (${f.country}, tot ${f.by}) staat niet meer in data.json; neem open verwachtingen ongewijzigd over`);
}

for (const m of waarschuwingen) console.warn('let op: ' + m);
if (fouten.length) {
  for (const m of fouten) console.error('FOUT: ' + m);
  console.error(`\n${fouten.length} fout(en) in data.json; niet archiveren en niet deployen.`);
  process.exit(1);
}
console.log(`data.json in orde: ${nEvents} events, ${nVw} verwachtingen, cyclus ${cyclus}.`);
if (ALLEEN_CHECK) process.exit(0);

// --- archiveren ------------------------------------------------------------
const incArchief = lees(INC_ARCHIEF, { updated: null, incidents: {} });
let nieuwInc = 0, nieuwVw = 0;
for (const r of data.regions) for (const c of r.countries) {
  c.events.forEach((e, i) => {
    const sleutel = [norm(c.name), e.date || 'ongoing', norm(e.place), e.type].join('|');
    const bestaand = incArchief.incidents[sleutel];
    if (bestaand) { bestaand.lastCycle = cyclus; return; }
    nieuwInc++;
    incArchief.incidents[sleutel] = {
      country: c.name, region: r.name, ...e, text: c.incidents[i],
      level: c.threat, firstCycle: cyclus, lastCycle: cyclus,
    };
  });
  for (const f of c.forecasts || []) {
    if (vwArchief.forecasts[f.id]) continue;
    nieuwVw++;
    vwArchief.forecasts[f.id] = { ...f, country: c.name, region: r.name, level: c.threat, cycle: cyclus };
    if (f.supersedes && vwArchief.forecasts[f.supersedes]) vwArchief.forecasts[f.supersedes].supersededBy = f.id;
  }
}
const nu = new Date().toISOString();
mkdirSync(dirname(INC_ARCHIEF), { recursive: true });
writeFileSync(INC_ARCHIEF, JSON.stringify({ updated: nu, incidents: incArchief.incidents }, null, 1) + '\n');
writeFileSync(VW_ARCHIEF, JSON.stringify({ updated: nu, scale: PHIA, forecasts: vwArchief.forecasts }, null, 1) + '\n');
console.log(`archief: ${nieuwInc} nieuwe incidenten (${Object.keys(incArchief.incidents).length} totaal), ${nieuwVw} nieuwe verwachtingen (${Object.keys(vwArchief.forecasts).length} totaal).`);
