// Hourly live-feed crawler for the Intel Briefing Dashboard.
// Pulls recent conflict/security headlines per monitored country from the
// GDELT DOC 2.0 API (free, refreshed every 15 min) and writes public/live.json.
// No analysis happens here — threat levels and COAs stay with the daily run.

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
const PER_COUNTRY = 4;
const TIMESPAN = "24h";
const DELAY_MS = 6500;  // GDELT rate-limits aggressively (~1 req/5s per IP)
const RETRIES = 3;
const BACKOFF_MS = 20000;

// Countries whose bare name is ambiguous or collides with other meanings.
const QUERY_OVERRIDES = {
  "Georgia": 'Georgia (Tbilisi OR Abkhazia OR "South Ossetia" OR Caucasus)',
  "Jordan": 'Jordan (Amman OR Jordanian)',
  "Chad": 'Chad ("N\'Djamena" OR Chadian OR "Lake Chad")',
  "Niger": 'Niger (Niamey OR Nigerien OR Tillaberi)',
  "Gaza": 'Gaza (Israel OR IDF OR Hamas OR Palestinian)'
};
const CONFLICT_TERMS = "(war OR attack OR strike OR military OR conflict OR security OR killed OR insurgent)";

function buildQuery(name) {
  // GDELT rejects quoted phrases shorter than ~5 chars; only quote multi-word names.
  const term = name.includes(" ") ? `"${name}"` : name;
  const base = QUERY_OVERRIDES[name] || `${term} ${CONFLICT_TERMS}`;
  return `${base} sourcelang:english`;
}

function parseSeenDate(s) {
  // GDELT format: 20260612T143000Z
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchCountry(name) {
  const url = GDELT + "?" + new URLSearchParams({
    query: buildQuery(name),
    mode: "ArtList",
    format: "json",
    maxrecords: String(PER_COUNTRY * 3),
    timespan: TIMESPAN,
    sort: "DateDesc"
  });
  let body;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "intel-briefing-dashboard/1.0" } });
    const text = await res.text();
    if (res.ok) {
      try { body = JSON.parse(text); break; }
      catch { throw new Error("GDELT: " + text.slice(0, 120)); }
    }
    if (res.status === 429 && attempt <= RETRIES) {
      await sleep(BACKOFF_MS * attempt);
      continue;
    }
    throw new Error("HTTP " + res.status + " " + text.slice(0, 80));
  }
  const seenTitles = new Set();
  const items = [];
  for (const a of body.articles || []) {
    if (!a.url || !a.title) continue;
    const key = a.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    const d = parseSeenDate(a.seendate);
    items.push({
      title: a.title.trim(),
      url: a.url,
      source: a.domain || "",
      date: d ? d.toISOString() : null
    });
    if (items.length >= PER_COUNTRY) break;
  }
  return items;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data.json"), "utf8"));
  const countries = data.regions.flatMap(r => r.countries.map(c => c.name));

  const live = { updated: new Date().toISOString(), countries: {} };
  let ok = 0, failed = 0;

  for (const name of countries) {
    try {
      const items = await fetchCountry(name);
      if (items.length) live.countries[name] = items;
      ok++;
    } catch (e) {
      failed++;
      console.error(`  ${name}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  if (ok === 0) {
    console.error("All GDELT requests failed — keeping previous live.json");
    process.exit(1);
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, "live.json"), JSON.stringify(live, null, 1));
  const total = Object.values(live.countries).reduce((n, a) => n + a.length, 0);
  console.log(`live.json written: ${total} headlines for ${Object.keys(live.countries).length}/${countries.length} countries (${failed} fetch failures)`);
}

main().catch(e => { console.error(e); process.exit(1); });
