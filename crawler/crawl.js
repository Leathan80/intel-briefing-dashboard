// Live-feed crawler for the Intel Briefing Dashboard.
// One Google News RSS query per monitored country (no API key, no aggressive
// rate-limiting — unlike GDELT, which throttles shared CI IPs into oblivion).
// Countries that fail keep the headlines from the previous run (carry-over).
// Writes public/live.json. No analysis here — threat levels & COAs stay daily.

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GNEWS = "https://news.google.com/rss/search";
const PER_COUNTRY = 4;
const WINDOW = "3d";              // headlines from the last 3 days
const DELAY_MS = 250;            // polite spacing; ~49 * 250ms = ~12s total
const RETRIES = 2;
const FETCH_TIMEOUT_MS = 15000;
const CONFLICT_TERMS = "war OR attack OR strike OR military OR conflict OR security OR killed OR protest OR unrest";

// Ambiguous names need a disambiguating phrase instead of the bare country name.
const QUERY_OVERRIDES = {
  "Georgia": '("Georgia" AND (Tbilisi OR Abkhazia OR Caucasus OR Russia))',
  "Jordan": '("Jordan" AND (Amman OR Jordanian))',
  "Chad": '("Chad" AND (Ndjamena OR Chadian OR Sahel))',
  "Niger": '("Niger" AND (Niamey OR Nigerien OR Sahel))',
  "Gaza": '(Gaza OR Rafah OR "Khan Younis")'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function buildUrl(name) {
  const base = QUERY_OVERRIDES[name] || `"${name}" (${CONFLICT_TERMS})`;
  const q = `${base} when:${WINDOW}`;
  return GNEWS + "?" + new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" });
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">"));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "") : "";
}

async function fetchCountry(name) {
  const url = buildUrl(name);
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { "User-Agent": "intel-briefing-dashboard/1.0" }, signal: ctrl.signal });
      if (!res.ok) {
        if (attempt <= RETRIES) { await sleep(1500 * attempt); continue; }
        throw new Error("HTTP " + res.status);
      }
      const xml = await res.text();
      const items = [];
      for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const block = m[1];
        let title = decodeEntities(tag(block, "title"));
        const source = decodeEntities(tag(block, "source"));
        // Google appends " - Source" to titles; strip it when redundant.
        if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
        const link = decodeEntities(tag(block, "link"));
        const pub = tag(block, "pubDate");
        const d = pub ? new Date(pub) : null;
        if (!title || !link) continue;
        items.push({ title, url: link, source, date: d && !isNaN(d) ? d.toISOString() : null });
        if (items.length >= PER_COUNTRY) break;
      }
      return items;
    } catch (e) {
      if (attempt <= RETRIES && (e.name === "AbortError")) { await sleep(1500); continue; }
      throw (e.name === "AbortError" ? new Error("timeout") : e);
    } finally {
      clearTimeout(timer);
    }
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data.json"), "utf8"));
  const countries = data.regions.flatMap(r => r.countries.map(c => c.name));

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "live.json"), "utf8")).countries || {}; } catch {}

  const live = { updated: new Date().toISOString(), countries: {} };
  let ok = 0, failed = 0, carried = 0;

  for (const name of countries) {
    try {
      const items = await fetchCountry(name);
      if (items.length) { live.countries[name] = items; ok++; }
      else if (prev[name]) { live.countries[name] = prev[name]; carried++; }
    } catch (e) {
      failed++;
      if (prev[name]) { live.countries[name] = prev[name]; carried++; }
      console.error(`  ${name}: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  if (ok === 0) {
    console.error("All Google News queries failed — keeping previous live.json");
    process.exit(1);
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, "live.json"), JSON.stringify(live, null, 1));
  const total = Object.values(live.countries).reduce((n, a) => n + a.length, 0);
  console.log(`live.json: ${total} koppen — vers voor ${ok} landen, ${carried} via carry-over, ${failed} fouten`);
}

main().catch(e => { console.error(e); process.exit(1); });
