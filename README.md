# Intel Briefing Dashboard — Firebase site

Live dashboard dat zijn data uit `public/data.json` laadt. Bij elke refresh haalt de
pagina de nieuwste gepubliceerde data op (cache staat uit via `firebase.json` headers).

## Structuur

- `public/index.html` — dashboard-template (rendert wat er in data.json staat)
- `public/data.json` — alle briefing-data (regio's, landen, incidenten, COA's)
- `firebase.json` — hosting-config met no-cache headers voor data.json

## Eenmalige setup

```powershell
firebase login
firebase projects:create intel-briefing-dashboard   # of maak er een aan via console.firebase.google.com
firebase use --add                                   # kies het project, alias "default"
```

## Publiceren / updaten

1. Genereer nieuwe data: vraag Claude "update de intel briefing dashboard data"
   (de intel-briefing skill verzamelt incidenten en schrijft `public/data.json` opnieuw).
2. Deploy:

```powershell
firebase deploy --only hosting
```

De site staat daarna op `https://<project-id>.web.app`. Iedereen die de pagina
refresht ziet direct de nieuwste versie — geen browsercache.

## Let op

- De site doet zelf geen nieuwsonderzoek; nieuwe intel verschijnt na een nieuwe
  verzamelronde + deploy (stap 1 en 2 hierboven).
- Wil je dit wekelijks automatisch? Dat kan met een geplande taak die Claude de
  data laat verversen en daarna `firebase deploy` draait.
