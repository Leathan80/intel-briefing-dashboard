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

Write-Host "Deployen naar Firebase Hosting..."
firebase deploy --only hosting
