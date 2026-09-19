# WhatsApp Personal Assistant V1

Personal assistant pribadi berbasis WhatsApp yang berjalan tanpa PC/VPS dedicated.

```text
WhatsApp (Meta test number)
        ↓
Cloudflare Worker
        ├── parser perintah Indonesia
        ├── Gemini (chat / intent ambigu)
        └── Notion
             ├── Inbox
             ├── Tasks
             └── Memory
```

V1 hanya mendukung pesan teks. Kalender, browsing otomatis, PDF, voice note, gambar, grup, multi-user, dan autonomous agent belum termasuk.

## 1. Persyaratan

- Akun Meta/Facebook yang dapat membuka Meta for Developers.
- Akun Cloudflare gratis.
- Akun Google untuk Google AI Studio / Gemini API.
- Akun Notion gratis.
- Node.js versi aktif/maintenance yang didukung Wrangler.

## 2. Install project

```bash
npm install
npm run cf-types
npm run typecheck
npm test
```

Versi dependency yang diuji/desain untuk V1 tercantum di `package.json`.

## 3. Buat tiga data source di Notion

Buat satu page, misalnya `Personal AI`, kemudian buat tiga database/data source berikut di dalamnya. Nama property harus sama persis.

### Inbox

| Property | Type | Values |
|---|---|---|
| Name | Title | — |
| Type | Select | Idea, Note |
| Content | Rich text | — |
| Source | Select | WhatsApp |
| Created | Created time | — |

### Tasks

| Property | Type | Values |
|---|---|---|
| Task | Title | — |
| Status | Select | To Do, Doing, Done |
| Priority | Select | Low, Medium, High |
| Due | Date | optional |
| Source | Select | WhatsApp |
| Created | Created time | — |

### Memory

| Property | Type | Values |
|---|---|---|
| Key | Title | — |
| Value | Rich text | — |
| Category | Select | Profile, Preference, Project, Other |
| Updated | Last edited time | — |

Buat Notion integration internal dari pengaturan integrations Notion. Berikan capability untuk membaca, memasukkan, dan memperbarui content. Hubungkan/share page `Personal AI` kepada integration tersebut agar ketiga data source dapat diakses.

V1 memakai Notion API `2026-03-11`. Pada API ini database adalah container dan row/schema memakai `data_source_id`. Jika Anda hanya memiliki database ID dari URL, panggil Retrieve Database atau lihat respons API untuk mendapatkan `data_sources[].id` masing-masing database. Simpan tiga ID tersebut untuk secret Worker.

## 4. Dapatkan Gemini API key

Buka Google AI Studio, buat Gemini API key untuk project Anda, lalu simpan nilainya. Default model V1 adalah:

```text
gemini-2.5-flash-lite
```

Worker memakai Gemini Interactions API secara stateless dengan `store=false`. V1 tidak memakai Gemini server-side conversation history dan tidak menyimpan ordinary chat transcript ke Notion.

Jangan kirim password, kredensial keuangan, dokumen sangat rahasia, atau secret lain melalui V1. Ketentuan penggunaan data Free Tier dapat berbeda dari Paid Tier.

## 5. Siapkan Meta WhatsApp test number

1. Buka Meta for Developers dan create/open app yang memiliki produk WhatsApp.
2. Gunakan test phone number yang diberikan Meta, bukan nomor WhatsApp utama Anda.
3. Tambahkan nomor WhatsApp pribadi Anda sebagai approved test recipient.
4. Catat `Phone Number ID`; ini menjadi `META_PHONE_NUMBER_ID`.
5. Gunakan temporary/test access token untuk smoke test awal. Fase nomor production/credential jangka panjang dilakukan terpisah.
6. Setelah Worker dideploy, gunakan URL yang dicetak Wrangler dan tambahkan `/webhook` sebagai callback URL. Jangan menebak subdomain akun Cloudflare.
7. Buat verify token acak yang Anda sendiri ketahui. Nilai di Meta harus sama persis dengan `META_VERIFY_TOKEN` pada Worker.
8. Subscribe field webhook yang diperlukan untuk incoming messages.
9. Isi `ALLOWED_WHATSAPP_NUMBER` dalam digit internasional tanpa tanda `+`, misalnya `62812...`. Nilainya harus sama dengan field incoming `from`.

Webhook POST diverifikasi dengan `X-Hub-Signature-256` menggunakan Meta App Secret sebelum payload diproses.

## 6. Login Cloudflare dan pasang secrets

```bash
npm install
npx wrangler login
npm run cf-types
npm run typecheck
npm test

npx wrangler secret put META_ACCESS_TOKEN
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_VERIFY_TOKEN
npx wrangler secret put META_PHONE_NUMBER_ID
npx wrangler secret put ALLOWED_WHATSAPP_NUMBER
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put NOTION_API_KEY
npx wrangler secret put NOTION_INBOX_DATA_SOURCE_ID
npx wrangler secret put NOTION_TASKS_DATA_SOURCE_ID
npx wrangler secret put NOTION_MEMORY_DATA_SOURCE_ID

npm run deploy
```

Masukkan nilai secret hanya ketika Wrangler meminta input. Jangan menaruh token sebagai argument command dan jangan commit `.dev.vars`.

`wrangler.jsonc` mendeklarasikan binding `DEDUP_KV`. Pada Wrangler 4 yang mendukung auto-provisioned bindings, deployment akan menyediakan namespace KV yang dibutuhkan dan memperbarui konfigurasi jika diperlukan.

Safe non-secret variables yang disimpan di `wrangler.jsonc`:

```text
META_GRAPH_API_VERSION=v26.0
GEMINI_MODEL=gemini-2.5-flash-lite
NOTION_VERSION=2026-03-11
```

## 7. Hubungkan callback Meta

Setelah `npm run deploy`, Wrangler akan mencetak URL Worker, misalnya bentuk umum:

```text
https://<nama-worker>.<subdomain-account>.workers.dev
```

Jangan menyalin contoh di atas. Gunakan URL persis dari output akun Anda.

Set Meta callback URL menjadi:

```text
<URL-WORKER-ANDA>/webhook
```

Verify token harus sama dengan nilai yang dimasukkan saat:

```bash
npx wrangler secret put META_VERIFY_TOKEN
```

Health endpoint:

```text
<URL-WORKER-ANDA>/health
```

Respons yang benar:

```json
{"status":"ok"}
```

## 8. Perintah V1

```text
Catat ide: bahas dark pattern dalam perlindungan konsumen
Catat hubungi dosen besok
Tambah tugas cari 5 jurnal, prioritas tinggi
Tambah tugas revisi bab 2 deadline 2026-09-03
Apa tugas saya?
Ingat bahwa topik utama proyek ini adalah personal AI WhatsApp
Apa yang kamu ingat tentang topik utama?
bantuan
```

Pesan biasa yang tidak cocok dengan perintah deterministik diteruskan ke Gemini.

## 9. Smoke test end-to-end

Lakukan berurutan:

1. Open `/health` dan pastikan `{"status":"ok"}`.
2. Meta webhook verification berhasil di developer dashboard.
3. Kirim `bantuan` dari approved WhatsApp number dan terima command menu.
4. Kirim `Catat ide: uji integrasi WhatsApp` dan pastikan tepat satu row muncul di Inbox.
5. Kirim `Tambah tugas uji daftar tugas, prioritas tinggi` dan pastikan tepat satu row muncul di Tasks.
6. Kirim `Apa tugas saya?` dan pastikan tugas baru muncul di balasan WhatsApp.
7. Kirim `Ingat bahwa proyek uji adalah personal AI WhatsApp` dan pastikan satu row Memory dibuat/di-update.
8. Kirim `Apa yang kamu ingat tentang proyek uji?` dan pastikan value tersimpan dikembalikan.
9. Kirim pertanyaan biasa dan pastikan Gemini membalas.
10. Replay satu captured webhook message ID dalam test lokal/integrasi dan pastikan tidak terjadi duplicate Notion write.
11. Kirim gambar dan pastikan balasan `V1 saat ini hanya mendukung pesan teks.`

Dedupe V1 menjamin suppression untuk repeated/sequential webhook delivery berdasarkan message ID selama 24 jam melalui `DEDUP_KV`. Workers KV bersifat eventually consistent dan tidak menyediakan atomic compare-and-set untuk request simultan dari beberapa PoP. Jika strict simultaneous global deduplication dibutuhkan, ganti komponen dedupe dengan Durable Object.

## 10. Logging dan privasi

Kode tidak mencatat access token, API key, full webhook JSON, atau full Notion content. Pada kegagalan background, log dibatasi pada WhatsApp message ID dan generic error message.

Untuk inspeksi deployment:

```bash
npx wrangler tail
```

Pastikan tidak ada secret atau isi pesan lengkap di log.

## 11. Test lokal

Test suite mencakup:

- health endpoint;
- parser perintah Indonesia;
- Meta webhook verification dan HMAC signature;
- WhatsApp payload extraction;
- outbound WhatsApp payload + one retry untuk 429/5xx;
- Notion Inbox/Tasks/Memory request shape;
- Gemini structured classification + stateless chat;
- router behavior dan truthful Notion failures;
- sender allowlist;
- KV replay dedupe;
- unsupported media handling.

Jalankan:

```bash
npm run typecheck
npm test
```

## 12. Batas V1

Belum ada:

- Google Calendar/reminder;
- web research;
- PDF/file reader;
- voice note;
- image understanding;
- WhatsApp group;
- multi-user;
- background autonomous agent;
- nomor WhatsApp production permanen.

Fitur tersebut masuk V2 dan tidak perlu ditambahkan sebelum V1 stabil.
