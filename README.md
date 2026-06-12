# Intel Briefing Dashboard

Live dashboard op **https://intel-briefing-dashboard.web.app** (Firebase Hosting,
project `intel-briefing-dashboard`).

## Architectuur

| Bestand | Inhoud | Wordt ververst door |
|---|---|---|
| `public/index.html` | Template: tabs, kaarten (Leaflet), risk tracker, live feed | handmatig (bij wijzigingen pushen + deployen) |
| `public/data.json` | Analyse: incidenten, threat-levels, COA's per land | dagelijkse Claude-taak (07:00, lokaal) |
| `public/history.json` | Threat-level historie (voedt Risk Tracker) | dagelijkse Claude-taak |
| `public/live.json` | Ruwe nieuwskoppen per land (GDELT) | GitHub Actions, elk uur |
| `public/world.geo.json` | Landsgrenzen voor de choropleth-kaart | nooit |

## Live feed (crawler)

`crawler/crawl.js` haalt per gemonitord land recente conflict-koppen op via de
gratis GDELT DOC 2.0 API en schrijft `public/live.json`. Let op: GDELT
rate-limit is ~1 request per 5 s, dus een volledige run duurt ±6 minuten.
Landnamen korter dan ~5 tekens mogen niet tussen quotes in de query.

Lokaal draaien: `node crawler/crawl.js`

## Automatisering

- **Elk uur** — GitHub Actions (`.github/workflows/live-feed.yml`): haalt eerst de
  actuele `data.json`/`history.json` van de live site (zodat de analyse nooit
  wordt teruggedraaid), draait de crawler en deployt. Vereist repo-secret
  `FIREBASE_TOKEN` (genereren met `firebase login:ci`).
- **Dagelijks 07:00** — Claude-taak `daily-intel-dashboard-update`: webresearch,
  herschrijft `data.json`, voegt snapshot toe aan `history.json`, haalt de
  actuele `live.json` van de live site op, deployt en pusht naar GitHub.

## Frontend-wijzigingen

`public/index.html` aanpassen → committen → pushen → `firebase deploy --only hosting`.
De kaart matcht landen op exacte naam tegen `world.geo.json`
(uitzondering: "Gaza" → "West Bank"-polygoon, zie `GEO_NAME_MAP`).
