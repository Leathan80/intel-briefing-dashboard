// Review-queue voor de AirDefense Academy threat-cards.
// Leest public/threat-feed.json (van threat-feed.js) en markeert koppen die
// kunnen wijzen op een verouderde kaartwaarde — verlies, nieuwe variant,
// levering, ontplooiing. Schrijft public/threat-review.json. GEEN automatische
// wijziging van kaartwaarden: dit is een cureer-hulpmiddel; de mens beslist.
//
// Kaartwaarden zelf staan gecureerd in de VKS-repo (js/data-threats.js).

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

// Signaalcategorieën: elk een label + woordpatronen (case-insensitive, hele woorden waar zinvol).
const SIGNALS = [
  { key: "loss",     label: "Verlies / uitgeschakeld", re: /\b(destroyed|shot down|downed|struck|hit|damaged|neutrali[sz]ed|wreck(?:ed|age)|loss|losses)\b/i },
  { key: "variant",  label: "Nieuwe variant / upgrade", re: /\b(new variant|upgraded|modernized|modernised|new version|next-gen|new missile|new radar|prototype|unveiled|reveal(?:ed|s)?)\b/i },
  { key: "deploy",   label: "Ontplooiing / levering",  re: /\b(deploy(?:ed|ment|s)?|delivered|delivery|entered service|operational|fielded|transferred|redeploy(?:ed|ment)?|relocat(?:ed|ion))\b/i },
  { key: "range",    label: "Bereik / prestatie",      re: /\b(range of|km range|extended range|longer range|new range|intercept(?:ed|s)?|record)\b/i }
];

function classify(title) {
  const hits = [];
  for (const s of SIGNALS) if (s.re.test(title)) hits.push(s.key);
  return hits;
}

function main() {
  let feed;
  try { feed = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "threat-feed.json"), "utf8")); }
  catch { console.error("Geen threat-feed.json — review overgeslagen"); return; }

  const flags = [];
  for (const id of Object.keys(feed.systems || {})) {
    for (const it of feed.systems[id]) {
      const signals = classify(it.title);
      if (signals.length) flags.push({ id: id, title: it.title, url: it.url, source: it.source || "", date: it.date || null, signals: signals });
    }
  }
  // Sorteer: meeste signalen eerst, dan nieuwste.
  flags.sort((a, b) => (b.signals.length - a.signals.length) || String(b.date).localeCompare(String(a.date)));

  const review = { updated: new Date().toISOString(), feedUpdated: feed.updated || null, count: flags.length, flags: flags };
  fs.writeFileSync(path.join(PUBLIC_DIR, "threat-review.json"), JSON.stringify(review, null, 1));
  console.log(`threat-review.json: ${flags.length} kandidaat-koppen gemarkeerd over ${Object.keys(feed.systems || {}).length} systemen`);
}

main();
