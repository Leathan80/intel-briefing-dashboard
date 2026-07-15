// Threat-feed crawler voor de AirDefense Academy (airdefense-academy.web.app).
// Zelfde patroon als crawl.js: één Google News RSS-query per wapensysteem uit
// crawler/threat-queries.json (ids = threat-card-ids van de VKS-site).
// Systemen die falen behouden de koppen van de vorige run (carry-over).
// Schrijft public/threat-feed.json. Ongecureerd nieuws — de site labelt het
// expliciet als "geen geverifieerde data"; de gecureerde kaartwaarden staan
// los hiervan in de VKS-repo (js/data-threats.js).

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GNEWS = "https://news.google.com/rss/search";
const PER_SYSTEM = 3;
const WINDOW = "7d";              // wapensysteem-nieuws is dunner dan landen-nieuws
const CONCURRENCY = 6;
const RETRIES = 2;
const FETCH_TIMEOUT_MS = 12000;

const QUERIES = JSON.parse(fs.readFileSync(path.join(__dirname, "threat-queries.json"), "utf8"));
delete QUERIES._comment;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function buildUrl(query) {
  const q = `(${query}) when:${WINDOW}`;
  return GNEWS + "?" + new URLSearchParams({ q, hl: "en-US", gl: "US", ceid: "US:en" });
}

function tag(block, name) {
  const m = block.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">"));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "") : "";
}

async function fetchSystem(id) {
  const url = buildUrl(QUERIES[id]);
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
        if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
        const link = decodeEntities(tag(block, "link"));
        const pub = tag(block, "pubDate");
        const d = pub ? new Date(pub) : null;
        if (!title || !link) continue;
        items.push({ title, url: link, source, date: d && !isNaN(d) ? d.toISOString() : null });
        if (items.length >= PER_SYSTEM) break;
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
  const ids = Object.keys(QUERIES);

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "threat-feed.json"), "utf8")).systems || {}; } catch {}

  const feed = { updated: new Date().toISOString(), systems: {} };
  let ok = 0, failed = 0, carried = 0;

  const queue = ids.slice();
  async function worker() {
    let id;
    while ((id = queue.shift()) !== undefined) {
      try {
        const items = await fetchSystem(id);
        if (items.length) { feed.systems[id] = items; ok++; }
        else if (prev[id]) { feed.systems[id] = prev[id]; carried++; }
      } catch (e) {
        failed++;
        if (prev[id]) { feed.systems[id] = prev[id]; carried++; }
        console.error(`  ${id}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (ok === 0 && Object.keys(prev).length === 0) {
    console.error("Alle threat-queries faalden en er is geen vorige feed — threat-feed.json niet geschreven");
    return; // niet fataal voor de workflow: live.json is het hoofdproduct
  }
  if (ok === 0) {
    console.error("Alle threat-queries faalden — vorige threat-feed.json blijft staan");
    return;
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, "threat-feed.json"), JSON.stringify(feed, null, 1));
  const total = Object.values(feed.systems).reduce((n, a) => n + a.length, 0);
  console.log(`threat-feed.json: ${total} koppen — vers voor ${ok} systemen, ${carried} via carry-over, ${failed} fouten`);
}

main().catch(e => { console.error(e); process.exit(1); });
