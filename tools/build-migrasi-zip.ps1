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

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $out) { Remove-Item -LiteralPath $out -Force }
$fs = [System.IO.File]::Open($out, [System.IO.FileMode]::Create)
$zipArch = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $stage -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($stage.Length + 1) -replace '\\', '/'
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipArch, $_.FullName, $rel, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally {
  $zipArch.Dispose()
  $fs.Dispose()
}
Remove-Item -LiteralPath $stage -Recurse -Force

# --- Verifikasi isi ZIP ---
$zip = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $rawNames = @($zip.Entries | ForEach-Object { $_.FullName })
  $names = @($rawNames | ForEach-Object { $_ -replace '\\', '/' })
} finally {
  $zip.Dispose()
}

$backslash = @($rawNames | Where-Object { $_ -like '*\*' })
if ($backslash.Count -gt 0) { throw ("ZIP mengandung entri backslash: " + ($backslash | Select-Object -First 5)) }

$bad = @($names | Where-Object { $_ -match '(^|/)node_modules/' -or $_ -match '(^|/)\.wrangler/' -or $_ -match '(^|/)\.superpowers/' -or $_ -match '(^|/)(coverage|scratch)/' -or $_ -match '(^|/)Chat WhatsApp' -or $_ -match '\.log$' -or $_ -match 'percakapan\.txt$' -or $_ -match '\.DS_Store$' -or $_ -match '(^|/)migrasi-ubuntu\.zip$' })
if ($bad.Count -gt 0) { throw ("ZIP mengandung path terlarang: " + ($bad | Select-Object -First 5)) }

foreach ($req in @('.git/HEAD', 'setup-ubuntu.sh', 'whatsapp-bridge/.env', 'wrangler.jsonc', 'docs/superpowers/specs/2026-10-05-ubuntu-migration-design.md', 'README.txt')) {
  if ($names -notcontains $req) { throw "ZIP kehilangan: $req" }
}
if (-not ($names | Where-Object { $_ -like 'whatsapp-bridge/auth_info_baileys/*' })) { throw "ZIP kehilangan session auth_info_baileys" }
if (-not ($names | Where-Object { $_ -like 'backup_v1_stable/*' })) { throw "ZIP kehilangan backup_v1_stable" }

$sizeMB = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ("OK: migrasi-ubuntu.zip  |  entri: {0}  |  ukuran: {1} MB" -f $names.Count, $sizeMB)
