# Veilige handmatige deploy voor het Intel Briefing Dashboard.
#
# live.json is EIGENDOM van de cloud-crawler (GitHub Actions, elke 15 min). Een lokale
# `firebase deploy` uploadt de hele public/-map en zou een verouderde lokale live.json
# over de verse cloud-versie heen zetten. Daarom halen we hier eerst de actuele live.json
# (en de crawler-timestamp) van de live site op vóór we deployen.
#
# data.json en history.json zijn EIGENDOM van de lokale dagelijkse analyse-taak — die
# blijven dus lokaal (niet ophalen), zodat een verse briefing niet wordt teruggedraaid.
#
# Gebruik: pwsh ./deploy.ps1   (vanuit de site-map)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "Actuele live.json van de site halen (crawler-eigendom)..."
curl.exe -s "https://intel-briefing-dashboard.web.app/live.json" -o "public/live.json"

# Controleert de events en verwachtingen in data.json en werkt het archief bij
# (archive/incidents.json en archive/forecasts.json, die alleen aangroeien).
# Bij een fout stopt de deploy: liever geen publicatie dan een herschreven verwachting.
Write-Host "data.json controleren en archiveren..."
node tools/archive.mjs
if ($LASTEXITCODE -ne 0) { throw "tools/archive.mjs vond fouten in data.json; niet gedeployd." }

Write-Host "Deployen naar Firebase Hosting..."
firebase deploy --only hosting
