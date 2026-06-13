// Live-feed crawler for the Intel Briefing Dashboard.
// One GDELT DOC 2.0 query per REGION (5 total, not 49 — GDELT throttles
// shared IPs such as GitHub runners hard). Articles are attributed to
// countries by title matching; countries without a match keep the headlines
// from the previous run (carry-over). Writes public/live.json.

const fs = require("fs");
const path = require("path");

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";
const PER_COUNTRY = 4;
const TIMESPAN = "24h";
const DELAY_MS = 7000;
const RETRIES = 3;
const BACKOFF_MS = 20000;
const CHUNK = 7; // max landen per query — GDELT weigert te lange queries
const FETCH_TIMEOUT_MS = 30000;
const CONFLICT_TERMS = "(war OR attack OR strike OR military OR conflict OR security OR killed OR insurgent)";

// Title patterns per country (lowercase regex). Aliases catch capitals,
// actors and hotspots so attribution works when the country name is absent.
const MATCH = {
  "Gaza": /gaza|rafah|khan younis/, "Lebanon": /lebanon|beirut|hezbollah/,
  "Iran": /\biran\b|iranian|tehran/, "Yemen": /yemen|houthi/,
  "Israel": /israel|idf\b/, "Iraq": /\biraq\b|iraqi|baghdad/,
  "Saudi Arabia": /saudi/, "Syria": /syria|damascus/,
  "Egypt": /egypt|cairo|sinai/, "Jordan": /jordan|amman/,
  "Libya": /libya|tripoli|benghazi/, "Tunisia": /tunisia|tunis\b/,
  "Ukraine": /ukrain|kyiv|kharkiv|donetsk|zaporizh|kherson/,
  "Russia": /russia|moscow|kremlin|putin/, "Belarus": /belarus|minsk/,
  "Moldova": /moldova|transnistria/, "Georgia": /georgia|tbilisi|abkhazia|ossetia/,
  "Armenia": /armenia|yerevan/, "Azerbaijan": /azerbaijan|baku/,
  "Mali": /\bmali\b|bamako|timbuktu/, "Niger": /\bniger\b|niamey|tillab/,
  "Burkina Faso": /burkina|ouagadougou/, "Sudan": /\bsudan\b|darfur|khartoum|el fasher/,
  "Chad": /\bchad\b|djamena/, "Mauritania": /mauritania|nouakchott/,
  "Nigeria": /nigeria|borno|zamfara|maiduguri/,
  "North Korea": /north korea|dprk|pyongyang|kim jong/, "Myanmar": /myanmar|burma|rakhine/,
  "Pakistan": /pakistan|islamabad|balochistan|peshawar/, "India": /\bindia\b|indian|kashmir|new delhi|manipur/,
  "China": /\bchina\b|chinese|beijing|\bpla\b/, "Taiwan": /taiwan|taipei/,
  "Philippines": /philippin|manila|mindanao/, "South Korea": /south korea|seoul|\brok\b/,
  "Vietnam": /vietnam|hanoi/, "Japan": /japan|tokyo/,
  "Indonesia": /indonesia|jakarta|papua/, "Thailand": /thailand|bangkok/,
  "Bangladesh": /bangladesh|dhaka|rohingya/, "Sri Lanka": /sri lanka|colombo/,
  "Venezuela": /venezuela|caracas|maduro/, "Haiti": /haiti|port-au-prince/,
  "Colombia": /colombia|bogot/, "Cuba": /\bcuba\b|cuban|havana/,
  "Ecuador": /ecuador|quito|guayaquil/, "Peru": /\bperu\b|peruvian|lima\b/,
  "Bolivia": /bolivia|la paz/, "Dominican Republic": /dominican|dajab/,
  "Jamaica": /jamaica|kingston/
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseSeenDate(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

function buildRegionQuery(countryNames) {
  // Quoted phrases under ~5 chars are rejected by GDELT; only quote multi-word names.
  const terms = countryNames.map(n => n.includes(" ") ? `"${n}"` : n);
  return `(${terms.join(" OR ")}) ${CONFLICT_TERMS} sourcelang:english`;
}

async function fetchRegion(regionName, countryNames) {
  const url = GDELT + "?" + new URLSearchParams({
    query: buildRegionQuery(countryNames),
    mode: "ArtList",
    format: "json",
    maxrecords: "120",
    timespan: TIMESPAN,
    sort: "DateDesc"
  });
  for (let attempt = 1; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "intel-briefing-dashboard/1.0" },
        signal: ctrl.signal
      });
      const text = await res.text();
      if (res.ok) {
        try { return JSON.parse(text).articles || []; }
        catch { throw new Error("GDELT: " + text.slice(0, 120)); }
      }
      if (res.status === 429 && attempt <= RETRIES) {
        await sleep(BACKOFF_MS * attempt);
        continue;
      }
      throw new Error("HTTP " + res.status + " " + text.slice(0, 80));
    } catch (e) {
      if (e.name === "AbortError") {
        if (attempt <= RETRIES) { await sleep(BACKOFF_MS); continue; }
        throw new Error("timeout after " + RETRIES + " retries");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

function attribute(articles, countryNames, out, seenTitles) {
  for (const a of articles) {
    if (!a.url || !a.title) continue;
    const key = a.title.toLowerCase().replace(/\W+/g, " ").trim();
    if (seenTitles.has(key)) continue;
    const lower = a.title.toLowerCase();
    const country = countryNames.find(n => MATCH[n] && MATCH[n].test(lower));
    if (!country) continue;
    out[country] = out[country] || [];
    if (out[country].length >= PER_COUNTRY) continue;
    seenTitles.add(key);
    const d = parseSeenDate(a.seendate);
    out[country].push({
      title: a.title.trim(),
      url: a.url,
      source: a.domain || "",
      date: d ? d.toISOString() : null
    });
  }
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "data.json"), "utf8"));

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "live.json"), "utf8")).countries || {}; } catch {}

  const fresh = {};
  const seenTitles = new Set();
  let ok = 0, failed = 0;

  for (const region of data.regions) {
    const names = region.countries.map(c => c.name);
    const chunks = [];
    for (let i = 0; i < names.length; i += CHUNK) chunks.push(names.slice(i, i + CHUNK));
    let articles = [];
    let chunkFails = 0;
    for (const chunk of chunks) {
      try {
        articles = articles.concat(await fetchRegion(region.name, chunk));
      } catch (e) {
        chunkFails++;
        console.error(`${region.name} (${chunk[0]}…): ${e.message}`);
      }
      await sleep(DELAY_MS);
    }
    attribute(articles, names, fresh, seenTitles);
    if (chunkFails < chunks.length) {
      ok++;
      console.log(`${region.name}: ${articles.length} artikelen opgehaald`);
    } else {
      failed++;
    }
  }

  if (ok === 0) {
    console.error("All GDELT region queries failed — keeping previous live.json");
    process.exit(1);
  }

  // Carry-over: countries without fresh headlines keep their previous feed.
  const live = { updated: new Date().toISOString(), countries: {} };
  const allCountries = data.regions.flatMap(r => r.countries.map(c => c.name));
  for (const name of allCountries) {
    if (fresh[name] && fresh[name].length) live.countries[name] = fresh[name];
    else if (prev[name]) live.countries[name] = prev[name];
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, "live.json"), JSON.stringify(live, null, 1));
  const freshCount = Object.keys(fresh).length;
  const total = Object.values(live.countries).reduce((n, a) => n + a.length, 0);
  console.log(`live.json: ${total} koppen, vers voor ${freshCount} landen, ${Object.keys(live.countries).length - freshCount} via carry-over (${failed}/${data.regions.length} regio-queries gefaald)`);
}

main().catch(e => { console.error(e); process.exit(1); });
