# Migrasi Proyek Windows → Ubuntu 20.04 — Design

**Tanggal:** 2026-10-05
**Status:** Approved (brainstorming: paket A — ZIP + script setup)

## Konteks

Proyek (`personal-ai-whatsapp` / Youyou + LIFE OS) berjalan di Windows 10/11 dengan Node 22. Aldo dual-boot Windows + Ubuntu 20.04 dan ingin pindah kerja ke Ubuntu. Medium transfer: HP (USB/OTG) atau flash drive. Windows tetap utuh (tidak ada yang dihapus).

## Tujuan

1. Satu paket ZIP berisi seluruh proyek (tanpa artefak yang tidak bisa dipakai di Linux).
2. Di Ubuntu, satu perintah `bash setup-ubuntu.sh` menyiapkan toolchain + dependensi + verifikasi.
3. Verifikasi di Ubuntu hijau: `npm test` lulus penuh, `npm run typecheck` bersih, `wrangler whoami` login, bridge bisa start.

## Non-goals

- Tidak memindah secret ke file: secret ada di server Cloudflare, cukup `wrangler login` di Ubuntu.
- Tidak menghapus/memodifikasi instalasi Windows.
- Tidak menambah fitur produk; perbaikan test/typecheck hanya yang menghalangi verifikasi.
- Tidak mengotomasi `wrangler login` (OAuth butuh browser).

## Desain

### 1. Isi paket `migrasi-ubuntu.zip`

Sumber: seluruh `C:\Users\a0398\Project`.

**Sertakan:** `src/`, `test/`, `docs/`, `whatsapp-bridge/` (tanpa `node_modules`), `whatsapp-bridge/.env`, `whatsapp-bridge/auth_info_baileys/` (session Baileys — portabel antar-OS), `backup_v1_stable/`, `.git/`, `README.md`, `README.txt`, `wrangler.jsonc`, `worker-configuration.d.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, file root lain yang bukan artefak.

**Kecualikan:** `node_modules/` (direktori apa pun, termasuk nested), `.wrangler/`, `coverage/`, `*.log`, `deploy.log`, `.superpowers/`, `scratch/`, `Chat WhatsApp*/`, `percakapan.txt` (log pribadi besar), file sistem (`.DS_Store`).

Alasan: `node_modules` Windows berisi binary `.node`/`.dll` yang rusak di Linux dan harus di-install ulang (680 MB mubazir). Target akhir ±41 MB.

### 2. `setup-ubuntu.sh` (dikirim di dalam zip)

Urutan, setiap langkah gagal-fast dengan pesan jelas:

1. Prasyarat: `git`, `curl` ada (kalau belum: `sudo apt install -y git curl`).
2. Node: cek `node -v`; jika < 22 → pasang **nvm** (risks: pakai skrip resmi nvm) → `nvm install 22` → `nvm use 22`.
3. Dependensi: `npm install` di root (pakai `package-lock.json`), lalu `cd whatsapp-bridge && npm install` (membangun ulang `sharp` + `ffmpeg-static` untuk Linux).
4. Verifikasi: `npm run typecheck` dan `npm test` → cetak ringkasan PASS/FAIL.
5. Cetak langkah manual (bagian 3).

Catatan: skrip tidak menjalankan `wrangler login` (interaktif/browser) dan tidak start proses (user memutuskan dev vs deploy).

### 3. Langkah manual (dicetak di akhir setup)

1. `npx wrangler login` → `npx wrangler whoami` (akun allaldo892@gmail.com, Account ID `55ca30adf1cc595484439d1952e6b251`).
2. `npx wrangler secret list` → pastikan `NOTION_API_KEY`, `NOTION_GOALS_DATA_SOURCE_ID`, `NOTION_LEARNING_DATA_SOURCE_ID`, `GEMINI_API_KEY`, dll sudah ada (sudah tersimpan di server — tidak perlu diisi ulang).
3. Jalankan: `npm run dev` (uji lokal) atau `npm run deploy`.
4. Bridge: `cd whatsapp-bridge && node index.js` — session disalin dari Windows; jika WhatsApp menolak session, scan QR yang muncul di terminal.

### 4. Pra-migrasi (di Windows, sebelum ZIP dibuat)

Perbaiki dulu agar verifikasi Ubuntu hijau:

- **Typecheck:** 2 error `Cannot find name 'process'` di `src/router.ts` (baris ~347) — ganti akses `process.env` dengan pola yang aman untuk tipe Worker (mis. `globalThis` guard / `typeof process`) tanpa mengubah perilaku runtime.
- **Test basi:** 3 test gagal karena hardcode tanggal `2026-09-02` (`test/date.test.ts`, `test/notion.test.ts` ×2) — stabilkan agar memakai tanggal relatif/fixed input, bukan "hari ini + N".

Verifikasi: `npm run typecheck` dan `npm test` hijau di Windows, lalu commit.

### 5. Pembuatan ZIP (di Windows)

- Skrip/powershell: kumpulkan file sesuai aturan bagian 1 → `Compress-Archive` → `migrasi-ubuntu.zip` di root proyek.
- Verifikasi paket: daftar isi ZIP tidak mengandung `node_modules/`, `.wrangler/`; jumlah file & keberadaan `.git/`, `setup-ubuntu.sh`, `whatsapp-bridge/.env`, `auth_info_baileys/` dicek.
- Catatan: ZIP tidak di-commit (masuk `.gitignore`).

## Rantai data & error handling

- Transfer HP: ZIP dipindah apa adanya (jangan di-recompress galeri). Jika korup, hash size dicek ulang di Ubuntu sebelum extract (`unzip -t`).
- `setup-ubuntu.sh` idempotent: boleh dijalankan ulang; `npm install` aman diulang.
- Jika nvm sudah ada / Node 22 sudah terpasang, langkah dilewati.
- Jika `wrangler login` gagal offline → dicatat sebagai langkah tunda, bukan blocker setup.

## Testing / Definisi selesai

| # | Kriteria | Bukti |
|---|----------|-------|
| 1 | Perbaikan test/typecheck Windows hijau | `npm run typecheck` + `npm test` PASS sebelum packaging |
| 2 | ZIP valid | `unzip -t` / daftar isi: tanpa `node_modules`, ada `.git` + `.env` + session |
| 3 | Setup Ubuntu sukses | `bash setup-ubuntu.sh` selesai, Node 22 terpasang, dependensi ter-build |
| 4 | Verifikasi Ubuntu hijau | `npm test` + `npm run typecheck` PASS di Ubuntu |
| 5 | Cloudflare terhubung | `npx wrangler whoami` + `secret list` menampilkan secret yang ada |
| 6 | Bridge hidup di Ubuntu | `node index.js` start (session aktif atau QR muncul) |
