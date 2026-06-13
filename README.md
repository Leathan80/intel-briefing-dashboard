# Intel Briefing Dashboard

Live dashboard op **https://intel-briefing-dashboard.web.app** (Firebase Hosting,
project `intel-briefing-dashboard`).

## Architectuur

| Bestand | Inhoud | Wordt ververst door |
|---|---|---|
| `public/index.html` | Template: tabs, kaarten (Leaflet), risk tracker, live feed | handmatig (bij wijzigingen pushen + deployen) |
| `public/data.json` | Analyse: incidenten, threat-levels, COA's per land | dagelijkse Claude-taak (07:00, lokaal) |
| `public/history.json` | Threat-level historie (voedt Risk Tracker) | dagelijkse Claude-taak |
| `public/live.json` | Ruwe nieuwskoppen per land (Google News RSS) | GitHub Actions, elke 4 uur |
| `public/world.geo.json` | Landsgrenzen voor de choropleth-kaart | nooit |

## Live feed (crawler)

`crawler/crawl.js` haalt per gemonitord land recente conflict-koppen op via
**Google News RSS** (één query per land, laatste 3 dagen) en schrijft
`public/live.json`. Geen API-key, geen rate-limiting; alle 49 landen in ~15 s.
Landen die falen behouden hun koppen uit de vorige run (carry-over).

> Eerder gebruikte dit GDELT, maar dat throttlet gedeelde CI-IP's onbruikbaar
> (429's, ook op GitHub-runners). Google News RSS heeft dat probleem niet.

Lokaal draaien: `node crawler/crawl.js`

## Automatisering

- **Elke 4 uur** — GitHub Actions (`.github/workflows/live-feed.yml`): haalt eerst
  de actuele `data.json`/`history.json`/`live.json` van de live site (zodat de
  dagelijkse analyse nooit wordt teruggedraaid), draait de crawler en deployt via
  de officiële `FirebaseExtended/action-hosting-deploy` met repo-secret
  `FIREBASE_SERVICE_ACCOUNT` (service account `github-action-deploy@…`).
  Repo is privé → elke 4 uur blijft binnen de gratis Actions-minuten; openbaar
  maken laat elk uur toe.
- **Dagelijks 07:00** — Claude-taak `daily-intel-dashboard-update`: webresearch,
  herschrijft `data.json`, voegt snapshot toe aan `history.json`, haalt de
  actuele `live.json` van de live site op, deployt en pusht naar GitHub.

## Frontend-wijzigingen

`public/index.html` aanpassen → committen → pushen → `firebase deploy --only hosting`.
De kaart matcht landen op exacte naam tegen `world.geo.json`
(uitzondering: "Gaza" → "West Bank"-polygoon, zie `GEO_NAME_MAP`).
