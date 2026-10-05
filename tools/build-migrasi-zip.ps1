$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'migrasi-ubuntu.zip'
$stage = Join-Path $env:TEMP ('migrasi-stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null

$excludeDir = '(^|\\)(node_modules|\.wrangler|coverage|\.superpowers|scratch)\\'
$excludeName = '^(deploy\.log|.*\.log|\.DS_Store|migrasi-ubuntu\.zip|percakapan\.txt)$'

$count = 0
Get-ChildItem -Path $root -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($root.Length + 1)
  if ($rel -match $excludeDir) { return }
  if ($rel -like 'Chat WhatsApp*') { return }
  if ($_.Name -match $excludeName) { return }
  $dest = Join-Path $stage $rel
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
  Copy-Item -LiteralPath $_.FullName -Destination $dest
  $count++
}
Write-Host "File distage: $count"

if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $out -CompressionLevel Optimal
Remove-Item -LiteralPath $stage -Recurse -Force

# --- Verifikasi isi ZIP ---
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $names = @($zip.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
} finally {
  $zip.Dispose()
}

$bad = @($names | Where-Object { $_ -match '(^|/)node_modules/' -or $_ -match '(^|/)\.wrangler/' -or $_ -match '(^|/)\.superpowers/' })
if ($bad.Count -gt 0) { throw ("ZIP mengandung path terlarang: " + ($bad | Select-Object -First 5)) }

foreach ($req in @('.git/HEAD', 'setup-ubuntu.sh', 'whatsapp-bridge/.env', 'wrangler.jsonc', 'docs/superpowers/specs/2026-10-05-ubuntu-migration-design.md')) {
  if ($names -notcontains $req) { throw "ZIP kehilangan: $req" }
}
if (-not ($names | Where-Object { $_ -like 'whatsapp-bridge/auth_info_baileys/*' })) { throw "ZIP kehilangan session auth_info_baileys" }

$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ("OK: migrasi-ubuntu.zip  |  entri: {0}  |  ukuran: {1} MB" -f $names.Count, $sizeMB)
