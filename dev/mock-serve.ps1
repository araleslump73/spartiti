# Prova l'app con un Google Drive FINTO (nessun account) sul tablet.
# Costruisce una copia temporanea con dev\mock.js e la serve su http://<IP-del-PC>:8766/index.html (Ctrl+C per fermare).
# Non tocca i file dell'app. La parte offline/service worker si prova solo sulla versione HTTPS pubblicata.
$app = Split-Path -Parent $PSScriptRoot
$out = Join-Path $env:TEMP "spartiti-mock"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $out | Out-Null
Copy-Item "$app\app.js","$app\manifest.webmanifest","$app\icon-192.png","$app\icon-512.png","$app\icon.svg" $out
Copy-Item "$app\pdfjs" $out -Recurse
Copy-Item "$PSScriptRoot\mock.js","$PSScriptRoot\pdf1.pdf","$PSScriptRoot\pdf2.pdf" $out
# il mock va caricato prima di app.js; il service worker si disattiva per provare sempre l'ultimo codice
(Get-Content "$app\index.html" -Raw) -replace '<script src="app.js"></script>','<script src="mock.js"></script><script src="app.js"></script>' | Set-Content "$out\index.html" -Encoding utf8 -NoNewline
(Get-Content "$out\app.js" -Raw) -replace 'navigator\.serviceWorker\.register\("sw\.js"\)','Promise.resolve(null).then' | Set-Content "$out\app.js" -Encoding utf8 -NoNewline
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' } | Select-Object -First 1).IPAddress
"Apri sul tablet:  http://${ip}:8766/index.html"
python -I -m http.server 8766 --bind 0.0.0.0 --directory $out
