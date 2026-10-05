# Migrasi Windows → Ubuntu 20.04 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menghasilkan paket `migrasi-ubuntu.zip` + `setup-ubuntu.sh` agar proyek bisa dipindah (via HP/USB) dan dijalankan di Ubuntu 20.04 dengan verifikasi hijau.

**Architecture:** (1) Perbaiki dulu verifikasi yang rusak di Windows (typecheck `process` + 3 test tanggal basi). (2) Tambah `setup-ubuntu.sh` (prasyarat → nvm/Node 22 → npm install root & bridge → typecheck/test → cetak langkah manual). (3) Skrip PowerShell `tools/build-migrasi-zip.ps1` membangun ZIP tanpa `node_modules`/`.wrangler`/logs dan memverifikasi isinya.

**Tech Stack:** PowerShell 5.1 (zip builder), Bash (setup Ubuntu), Node 22, Vitest, Wrangler 4, Git Bash untuk `bash -n` di Windows.

**Spec:** `docs/superpowers/specs/2026-10-05-ubuntu-migration-design.md`

## Global Constraints

- Semua perintah dijalankan dari `C:\Users\a0398\Project` (kecuali disebut lain).
- ZIP **wajib** memuat: `.git/`, `whatsapp-bridge/.env`, `whatsapp-bridge/auth_info_baileys/`, `setup-ubuntu.sh`, `backup_v1_stable/`, `docs/`, `README.txt`.
- ZIP **tidak boleh** memuat: `node_modules/`, `.wrangler/`, `coverage/`, `.superpowers/`, `scratch/`, `Chat WhatsApp*/`, `*.log`, `deploy.log`, `percakapan.txt`, `.DS_Store`, `migrasi-ubuntu.zip` itu sendiri.
- Tidak mengubah perilaku runtime produk kecuali guard `process` (perilaku identik di Node & Worker).
- `migrasi-ubuntu.zip` masuk `.gitignore` (tidak pernah di-commit).
- Node floor: 22 (Ubuntu 20.04 glibc 2.31 memadai untuk Node 22).
- Commit message mengikuti gaya repo: `feat:`/`fix:`/`chore:`/`docs:`.

## File map

| File | Responsibility |
|------|----------------|
| `src/router.ts:344-349` | Guard `process.env` via `globalThis` (fix typecheck) |
| `test/date.test.ts:199-207` | Fix assertion DateTime dengan `ref` (Backend Guard month/year) |
| `test/notion.test.ts:66-90` | Freeze waktu Task 53 create/update |
| `setup-ubuntu.sh` (baru) | Setup + verifikasi di Ubuntu |
| `tools/build-migrasi-zip.ps1` (baru) | Bangun + verifikasi ZIP |
| `.gitignore` | Tambah `migrasi-ubuntu.zip` |

---

### Task 1: Fix typecheck — guard `process` di router

**Root cause:** `src/router.ts:347-348` memakai `process.env` tapi tipe Worker (`lib: WebWorker`, tanpa `@types/node`) tidak mengenal `process` → `TS2591`.

**Files:**
- Modify: `src/router.ts:344-349`

**Interfaces:**
- Produces: blok `inTest` dengan tipe aman Worker; nama variabel `inTest`, `delay`, `textOnlyFallback` tidak berubah (dipakai baris 350-354).

- [ ] **Step 1: Ganti blok `inTest`**

Sebelum:

```ts
            const inTest =
              process.env.VITEST === "true" ||
              process.env.NODE_ENV === "test" ||
              typeof (globalThis as { __vitest_worker__?: unknown }).__vitest_worker__ !== "undefined";
```

Sesudah:

```ts
            const g = globalThis as {
              process?: { env?: Record<string, string | undefined> };
              __vitest_worker__?: unknown;
            };
            const inTest =
              g.process?.env?.VITEST === "true" ||
              g.process?.env?.NODE_ENV === "test" ||
              typeof g.__vitest_worker__ !== "undefined";
```

- [ ] **Step 2: Typecheck hijau**

Run: `npm run typecheck`
Expected: tanpa error (sebelumnya 2 error TS2591).

- [ ] **Step 3: Test tidak regresi**

Run: `npm test`
Expected: hanya 3 kegagalan date/notion yang sudah diketahui (Task 2); 389 lulus.

- [ ] **Step 4: Commit**

```bash
git add src/router.ts
git commit -m "fix: guard process.env access for Worker types"
```

---

### Task 1b: Fix 8 pre-existing type error di proyek test/ (temuan rencana)

**Root cause:** `&&` di npm script typecheck menyembunyikan error proyek `test/tsconfig.json` selama `src` masih gagal. Setelah Task 1, muncul 8 error pre-existing di BASE: fixture `AppConfig` kurang field (`notion*DataSourceId`, `allowedWhatsappIdentities`), kategori `"Health"` di luar union memory, `deadline: undefined` vs `exactOptionalPropertyTypes`, dan `node:module` tanpa node types.

**Files:** `test/action-safety.test.ts`, `test/notion-goals.test.ts`, `test/notion-projects.test.ts`, `test/notion.test.ts`, `test/pending-memory-state.test.ts`, `test/project-intelligence.test.ts`, `test/public-stiker-access.test.ts`, mungkin `test/tsconfig.json`.

**Gate:** `npm run typecheck` exit 0 (kedua proyek); `npm test` tidak berubah (389 pass / 3 gagal date-notion); tanpa perubahan `src/`.

**Spesifikasi lengkap (daftar 8 error + aturan perbaikan per kasus):** brief eksternal `.superpowers/sdd/2026-10-05-ubuntu-migration/task-1b-brief.md` (artefak SDD, dihasilkan controller — rencana ini tidak mengulangnya).

- [ ] Implement → typecheck hijau + test tak berubah → commit `fix: resolve pre-existing type errors in test project`

---

### Task 2: Fix 3 test tanggal basi (Backend Guard vs waktu sekarang)

**Root cause:** Backend Guard di `normalizeNotionDue` (`src/date.ts:236-239`) menimpa tahun/bulan input yang beda dengan bulan berjalan → test yang hardcode `2026-09-02` gagal mulai 2026-10-01.

**Files:**
- Modify: `test/date.test.ts:199-207`
- Modify: `test/notion.test.ts` (dua test `Task 53`)

**Interfaces:**
- Consumes: `normalizeNotionDue(raw, now?)` — param `now` menentukan bulan referensi guard.
- Consumes: `vi.setSystemTime` / `vi.useRealTimers` (pola sama dengan `test/cron.test.ts`); `vi` sudah di-import di `test/notion.test.ts:1`.

- [ ] **Step 1: Fix `test/date.test.ts` — pakai `ref` pada assertion DateTime**

Ganti blok baris 199-206:

```ts
    const ref = new Date("2026-09-02T10:00:00+07:00");

    // Date-only -> let it be
    expect(normalizeNotionDue("2026-09-02")).toBe("2026-09-02");

    // DateTime string -> enforce +07:00 (ref bulan sama agar Backend Guard lewat)
    expect(normalizeNotionDue("2026-09-02T16:46:00+07:00", ref)).toBe("2026-09-02T16:46:00+07:00");
```

Lalu **hapus** deklarasi `const ref = new Date("2026-09-02T10:00:00+07:00");` lama di baris ~206 (sekarang sudah di-hoist; baris 207-215 tetap memakai `ref` yang sama).

- [ ] **Step 2: Fix `test/notion.test.ts` — freeze waktu di dua test Task 53**

Test create (mulai baris ~66) — bungkus isi test:

```ts
it("Task 53: creates a task with sanitized title and correctly formatted datetime", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T03:00:00Z")); // 2026-09-02 10:00 WIB
  try {
    let bodyWithTime: any;
    const fakeFetch: typeof fetch = async (_input, init) => { bodyWithTime = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task" }), { status: 200 }); };

    await createTask(config, { task: "foo Konteks: Deadline jam 16:46", priority: "High", due_date: "2026-09-02", due_time: "16:46" }, fakeFetch);

    expect(bodyWithTime.properties.Task.title[0].text.content).toBe("foo");
    expect(bodyWithTime.properties.Due.date.start).toBe("2026-09-02T16:46:00+07:00");

    await createTask(config, { task: "bar", priority: "High", due_date: "2026-09-02", due_time: "18:08" }, fakeFetch);
    expect(bodyWithTime.properties.Due.date.start).toContain("T");
    expect(bodyWithTime.properties.Due.date.start).toContain("+07:00");
  } finally {
    vi.useRealTimers();
  }
});
```

Test update (mulai baris ~82):

```ts
it("Task 53: updates a task with sanitized title and correctly formatted datetime", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-02T03:00:00Z")); // 2026-09-02 10:00 WIB
  try {
    let bodyUpdate: any;
    const fakeFetch: typeof fetch = async (_input, init) => { bodyUpdate = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task" }), { status: 200 }); };

    await updateTask(config, "task-id", { due_date: "2026-09-02", due_time: "16:46" }, fakeFetch);

    expect(bodyUpdate.properties.Due.date.start).toBe("2026-09-02T16:46:00+07:00");
  } finally {
    vi.useRealTimers();
  }
});
```

- [ ] **Step 3: Jalankan dua file test**

Run: `npx vitest run test/date.test.ts test/notion.test.ts`
Expected: semua PASS (0 gagal).

- [ ] **Step 4: Full suite hijau**

Run: `npm test`
Expected: `Test Files 28 passed (28)`, `Tests 392 passed (392)`.

- [ ] **Step 5: Commit**

```bash
git add test/date.test.ts test/notion.test.ts
git commit -m "fix: make Task 53 date tests time-independent"
```

---

### Task 3: `setup-ubuntu.sh`

**Files:**
- Create: `setup-ubuntu.sh` (root proyek)

**Interfaces:**
- Produces: script idempoten; exit code selalu 0 bila langkah setup sukses (kegagalan test dicetak sebagai ringkasan, tidak menggagalkan script, agar langkah manual selalu tampil).

- [ ] **Step 1: Tulis `setup-ubuntu.sh`**

Isi lengkap:

```bash
#!/usr/bin/env bash
# Setup proyek personal-ai-whatsapp di Ubuntu 20.04+ (dari paket migrasi-ubuntu.zip).
set -u

cd "$(dirname "$0")"
echo "== Migrasi proyek ke Ubuntu =="

# 1. Prasyarat
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "Butuh git & curl. Jalankan dulu:"
  echo "  sudo apt update && sudo apt install -y git curl"
  exit 1
fi

# 2. Node.js 22 via nvm (Ubuntu 20.04 default Node 10 -> terlalu tua)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then . "$NVM_DIR/nvm.sh"; fi
NODE_MAJOR="$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/')"
if [ -z "$NODE_MAJOR" ]; then NODE_MAJOR=0; fi
if [ "$NODE_MAJOR" -lt 22 ]; then
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    echo "Memasang nvm..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
    . "$NVM_DIR/nvm.sh"
  fi
  nvm install 22
  nvm use 22
fi
echo "Node: $(node -v)  npm: $(npm -v)"

# 3. Dependensi (binary sharp/ffmpeg-static dibangun ulang untuk Linux)
echo "==> npm install (root)"
if ! npm install; then echo "Gagal: npm install root"; exit 1; fi
echo "==> npm install (whatsapp-bridge)"
if ! (cd whatsapp-bridge && npm install); then echo "Gagal: npm install bridge"; exit 1; fi

# 4. Verifikasi (kegagalan tidak menghentikan langkah manual)
echo "==> typecheck"
npm run typecheck; TC=$?
echo "==> test"
npm test; TEST=$?

cat <<EOF

=== Langkah manual selanjutnya ===
1. Login Cloudflare:
     npx wrangler login
     npx wrangler whoami
2. Pastikan secret sudah ada (sudah tersimpan di server, TIDAK perlu diisi ulang):
     npx wrangler secret list
3. Jalankan worker:
     npm run dev            (uji lokal)
     atau npm run deploy    (deploy dari Ubuntu)
4. Bridge WhatsApp:
     cd whatsapp-bridge && node index.js
   Session disalin dari Windows; kalau WhatsApp menolak, scan QR di terminal.

Ringkasan verifikasi: typecheck exit=$TC, test exit=$TEST
EOF
exit 0
```

- [ ] **Step 2: Cek sintaks dengan Git Bash**

Run: `& 'C:\Program Files\Git\bin\bash.exe' -n setup-ubuntu.sh`
Expected: tanpa output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add setup-ubuntu.sh
git commit -m "feat: add Ubuntu setup script"
```

---

### Task 4: Paket ZIP — `tools/build-migrasi-zip.ps1`

**Files:**
- Create: `tools/build-migrasi-zip.ps1`
- Modify: `.gitignore` (tambah baris `migrasi-ubuntu.zip`)

**Interfaces:**
- Consumes: daftar kecualikan di Global Constraints.
- Produces: `C:\Users\a0398\Project\migrasi-ubuntu.zip` + verifikasi isi (throw jika melanggar).

- [ ] **Step 1: Tulis `tools/build-migrasi-zip.ps1`**

Isi lengkap:

```powershell
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
```

- [ ] **Step 2: Tambah `.gitignore`**

Tambahkan baris baru (mis. setelah `deploy.log`):

```
migrasi-ubuntu.zip
```

- [ ] **Step 3: Jalankan builder**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-migrasi-zip.ps1`
Expected: `OK: migrasi-ubuntu.zip | entri: ... | ukuran: ... MB` tanpa exception.

- [ ] **Step 4: Cek manual isi ZIP (spot check)**

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[System.IO.Compression.ZipFile]::OpenRead("$PWD\migrasi-ubuntu.zip")
@($z.Entries | Where-Object { $_.FullName -match 'auth_info_baileys|\.git\\HEAD|\.env$' } | Select-Object -First 8 -ExpandProperty FullName)
$z.Dispose()
```
Expected: minimal 1 entri session, `.git/HEAD`, `whatsapp-bridge/.env` muncul.

- [ ] **Step 5: Commit script (ZIP tidak di-commit)**

```bash
git add tools/build-migrasi-zip.ps1 .gitignore
git commit -m "chore: add migration zip builder"
```

**Amendments setelah review Task 4** (blok kode di atas = draft awal; versi final ada di `tools/build-migrasi-zip.ps1`):
1. Regex exclude: `\\(dir)\\` → `(^|\\)(dir)\\` — pola lama tidak match path level-root (`node_modules\`, `.wrangler\`, `.superpowers\`, `coverage\`, `scratch\` di root) → verifikasi selalu throw.
2. Required array ditambah `README.txt` dan entri `backup_v1_stable/*` (Global Constraints: 7 must-contain).
3. `$bad` diperluas ke seluruh 11 kecualian spec: `(^|/)(coverage|scratch)/`, `(^|/)Chat WhatsApp`, `\.log$`, `percakapan\.txt$`, `\.DS_Store$`, `(^|/)migrasi-ubuntu\.zip$`.
4. Penulis entri: `Compress-Archive` (PS5.1 menulis separator backslash → ekstraksi di Ubuntu berisiko nama file literal `dir\file`) diganti loop manual .NET `ZipFileExtensions.CreateEntryFromFile` dengan nama entri forward-slash + asersi 0 entri ber-backslash.

---

### Task 5: Verifikasi akhir + commit dokumen + handoff

**Files:**
- Commit: `docs/superpowers/specs/2026-10-05-ubuntu-migration-design.md`, `docs/superpowers/plans/2026-10-05-ubuntu-migration.md`

- [ ] **Step 1: Verifikasi Windows hijau**

Run: `npm run typecheck` (Expected: tanpa error) dan `npm test` (Expected: 392/392 PASS).

- [ ] **Step 2: Rebuild ZIP final**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\build-migrasi-zip.ps1`
Expected: `OK: ...` (ZIP memuat kode final setelah Task 1-2).

- [ ] **Step 3: Commit dokumen**

```bash
git add docs/superpowers/specs/2026-10-05-ubuntu-migration-design.md docs/superpowers/plans/2026-10-05-ubuntu-migration.md
git commit -m "docs: add Ubuntu migration spec and plan"
```

- [ ] **Step 4: Serahkan handoff checklist ke Aldo**

Cetak ringkasan (tidak perlu file): cara copy `migrasi-ubuntu.zip` ke HP/USB → extract di Ubuntu → `bash setup-ubuntu.sh` → 4 langkah manual (wrangler login, secret list, npm run dev/deploy, bridge).

**Definisi selesai (dari spek):**
| # | Kriteria | Bukti |
|---|----------|-------|
| 1 | Typecheck + test hijau Windows | Step Task 1-2 & Task 5.1 |
| 2 | ZIP valid tanpa node_modules, ada `.git`/`.env`/session | Step Task 4.3-4.4 |
| 3-6 | Setup Ubuntu, test hijau, wrangler login, bridge jalan | Di Ubuntu (manual, setelah transfer) |

## Spec coverage

| Item spek | Task |
|-----------|------|
| Bagian 4 — fix typecheck | 1 |
| Bagian 4 — fix 3 test basi | 2 |
| Bagian 2 — setup-ubuntu.sh | 3 |
| Bagian 1 + 5 — ZIP builder & verifikasi | 4 |
| Definisi selesai 1-2 + commit dokumen + handoff | 5 |
| Definisi selesai 3-6 (Ubuntu) | manual setelah transfer |

