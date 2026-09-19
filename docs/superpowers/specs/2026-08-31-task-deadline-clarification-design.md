# V1.0.1 Task Deadline Parsing + Clarification State Design Specification

## 1. Problem
Pada V1 baseline, pembuatan tugas (Task) dari Telegram telah berfungsi dengan prioritas yang sesuai. Namun, pengguna tidak dapat menentukan tenggat waktu (deadline) menggunakan bahasa natural (seperti "besok" atau "senin depan"). Ekspresi deadline saat ini diabaikan (tidak masuk ke property `Due` di Notion) dan justru ikut tertulis sebagai bagian dari judul task.

## 2. Goals
- Mengurai (parse) ekspresi deadline dalam bahasa natural berbahasa Indonesia secara deterministik.
- Menyimpan hasil uraian tanggal ke property `Due` di database Notion Tasks.
- Menghapus ekspresi deadline dari judul task yang tersimpan (cleaned task title).
- Menangani deadline yang ambigu (misalnya "tanggal 5") melalui state klarifikasi yang interaktif, tanpa menyimpan task secara prematur.

## 3. Non-goals (Out of Scope)
- Pengingat (reminders) atau pesan Telegram terjadwal.
- Cloudflare Cron, Google Calendar, recurring tasks.
- Fitur Edit/Delete task.
- Tenggat waktu spesifik jam (time-of-day).
- Timezone per-user atau multi-user support (selalu `Asia/Jakarta`).
- Penggunaan Gemini/LLM untuk ekstraksi tanggal pada V1.0.1 (harus parser deterministik).
- Pemrosesan bahasa natural di luar pola Indonesia yang disepakati.
- Menambahkan property schema baru di Notion sebagai penanda idempotency.
- Rekonsiliasi otomatis jika terjadi *unknown outcome* jaringan.
- Jaminan terdistribusi (Distributed Transaction Guarantee) secara strict exactly-once antara Cloudflare KV dan Notion.

## 4. Existing Architecture Impact
- **Parser**: Modul parser diekspansi memisahkan ekstraksi tanggal dari ekstraksi judul task/prioritas (direkomendasikan `src/date.ts`).
- **Router**: Memiliki prioritas baru untuk menangkap jawaban klarifikasi sebelum masuk ke parser command biasa.
- **Storage**: Memanfaatkan KV namespace `DEDUP_KV` untuk state klarifikasi (key direkomendasikan `pending-task:<telegram-user-id>`), dilengkapi dengan *State Machine* spesifik.
- **Notion**: Skema Notion Tasks tidak berubah. `createTask` dimodifikasi untuk menyisipkan object date jika `Due` ada, dan tidak mengirimkannya jika `Due` kosong.

## 5. User-visible Behavior
1. **Sukses Langsung**: 
   - *User*: "Tambah tugas laporan praktikum, deadline besok"
   - *Bot*: Membuat task "laporan praktikum", Due = besok, lalu membalas sukses.
2. **Ambigu & Klarifikasi**:
   - *User*: "Tambah tugas bayar tagihan, deadline tanggal 5"
   - *Bot*: Tidak membuat task. "Tanggal 5 bulan apa?"
   - *User*: "September"
   - *Bot*: Memproses state menjadi COMPLETED, membuat task dengan Due = 5 September tahun relevan, membalas sukses.
3. **Kadaluwarsa Klarifikasi**:
   - Jawaban klarifikasi lebih dari 15 menit setelah ditanya akan diabaikan (dianggap salah paham) dan sistem meminta mengulang command awal.

## 6. Date Semantics
- **Timezone**: Seluruh perhitungan waktu relatif berbasis `Asia/Jakarta`. Reference date / "today" di-inject ke dalam parser agar testable.
- **Bare Weekday Semantics (tanpa "depan")**:
  - Mencari iterasi hari tersebut (next occurrence) **strictly after** reference local date, dengan *offset* 1-7 hari.
  - *Tidak pernah resolve ke hari yang sama*.
  - Contoh Reference: Monday 2026-08-31 Asia/Jakarta
    - "Selasa" -> 2026-09-01 (+1 hari)
    - "Rabu"   -> 2026-09-02 (+2 hari)
    - "Minggu" -> 2026-09-06 (+6 hari)
    - "Senin"  -> 2026-09-07 (+7 hari)
- **Weekday Semantics dengan "<weekday> depan"**:
  - Hari tersebut pada **next calendar week** berdasarkan standar minggu (Senin-Minggu) Asia/Jakarta.
  - Contoh Reference: Monday 2026-08-31 Asia/Jakarta
    - "Senin depan" -> 2026-09-07 (+7 hari)
    - "Selasa depan" -> 2026-09-08 (+8 hari)
    - "hari Minggu depan" -> 2026-09-13 (+13 hari) (Gunakan 'hari' untuk secara eksplisit menunjuk hari Minggu, bukan minggu depan secara umum)
- **Frasa "minggu depan" (case-insensitive, contoh: "Minggu depan" atau "minggu depan")**:
  - Karena parser case-insensitive, frasa ini akan selalu dianggap ambigu. Wajib masuk ke status klarifikasi. Bot harus merespons: *"Hari apa minggu depan?"*
  - **TIDAK ADA** penulisan otomatis ke Notion.
  - Jika user menjawab klarifikasi dengan hari tertentu (contoh: "Kamis"), maka hari tersebut akan diartikan berada di dalam **next calendar week**, bukan aturan *bare weekday* biasa. (Contoh jika Ref Monday 2026-08-31, "minggu depan" -> "Kamis" = 2026-09-10).
- **Year Inference Rule (Aturan Penentuan Tahun)**:
  - Format eksplisit hari dan bulan (misal "5 September"): Pilih occurrence terdekat di masa depan atau hari ini.
  - Jika tanggal/bulan sudah lewat pada kalender referensi saat ini, otomatis menggunakan *tahun depan* (`year + 1`).
  - Jika belum terlewat atau tepat hari ini, gunakan *tahun ini* (`year`).

## 7. Clarification State Machine
State disimpan di Cloudflare KV (`DEDUP_KV`) dengan key `pending-task:<telegram-user-id>`. Minimum state memiliki identifikasi `operationId` yang stabil.

**Status Mesin State:**
1. **AWAITING_CLARIFICATION / READY**: Menunggu jawaban pengguna.
2. **PROCESSING**: Sistem sedang mengeksekusi request HTTP ke Notion. Mencegah race condition dari double tap/reply.
3. **UNKNOWN_OUTCOME**: Kegagalan jaringan atau server di mana tidak dapat dipastikan apakah *Task* berhasil terbentuk di Notion atau tidak.
4. **COMPLETED**: Tombstone state. Menandakan task telah terkonfirmasi berhasil dikirim dan tersimpan di Notion.

## 8. Processing Flow & Notion Failure Ordering
Alur pemrosesan jawaban klarifikasi lengkap (misal: "September" atau "Kamis"):
1. **Persist state sebagai PROCESSING**: Ubah status KV menjadi `PROCESSING` terlebih dahulu (menyimpan `operationId`, `taskText`, `priority`, `resolved due`, `createdAt`, `processingStartedAt`).
2. **Call Notion `createTask`**: Lakukan eksekusi HTTP ke Notion.
3. **Jika Notion SUKSES (Confirmed 2xx)**:
   - Ubah state KV menjadi `COMPLETED` (tombstone).
   - *Tombstone* ini mencegah pembuatan task ganda untuk payload klarifikasi yang sama.
4. **Jika Notion DEFINITE REJECTION (Explicit 4xx)**:
   - Apabila Notion dengan pasti menolak request (contoh: 400 validation error, 403 permission, 404 not found).
   - Kembalikan state KV ke status *retryable* **READY**.
   - Berikan balasan gagal ke user yang mengizinkan user untuk me-*retry* atau memperbaiki inputnya nanti.
5. **Jika UNKNOWN OUTCOME (HTTP 5xx, Fetch/Network Exception)**:
   - Jika terjadi network timeout, connection reset, fetch exception, HTTP 5xx, atau malformed response.
   - Ubah state menjadi **UNKNOWN_OUTCOME** dengan mempertahankan `operationId` dan payload resolusi.
   - **TIDAK ADA** panggilan `createTask` ulang (NO automatic retry).
   - Jika *user* mengirim klarifikasi ulang/retry manual untuk status ini, batas/berikan balasan: *"Status penyimpanan tugas belum dapat dipastikan. Saya tidak akan menyimpan ulang otomatis agar tidak membuat tugas ganda."*
   - Hal ini melindungi duplikasi buta jika server Notion sebenarnya sudah melakukan commit data.
6. **Jika Update Masuk Saat PROCESSING**:
   - Jangan memanggil Notion lagi. Balas dengan batas yang sopan: *"Tugas sedang diproses."*
7. **Jika Update Masuk Saat COMPLETED (Tombstone)**:
   - Jika pengguna membalas jawaban serupa, abaikan pembuatan task. Balas: *"Tugas tersebut sudah tersimpan."*

**TTL:**
Baik `COMPLETED`, `UNKNOWN_OUTCOME`, maupun state *pending* biasa menggunakan remaining TTL 15 menit. Pengguna mungkin harus memeriksa *Notion* manual jika terjadi status *unknown outcome* sebelum mencoba kembali setelah state lenyap.

## 9. Cross-Service Limitation (Distributed Transaction Risk)
Spesifikasi ini secara eksplisit mendeklarasikan bahwa Cloudflare KV dan Notion API **tidak membentuk arsitektur atomic distributed transaction**.
- Mekanisme `UNKNOWN_OUTCOME` secara fundamental meredam duplicate risk (sehingga lebih aman dibandingkan retry buta), namun sistem ini **TIDAK** memberikan *mathematical exactly-once guarantee* yang ketat.
- Jika eksekusi Notion `createTask` *SUKSES*, TETAPI Worker *crash* seketika sebelum sempat menahan status menjadi `COMPLETED` di KV: Risiko duplikasi residual crash-boundary masih dapat eksis.
- Mengingat penambahan property *idempotency marker* pada schema Notion adalah OUT OF SCOPE pada V1.0.1, keterbatasan ini harus dipahami.
- Di luar crash tersebut: Duplikasi *update_id* Telegram diamankan oleh `tg:<update_id>` dedupe, dan manual *retry* diselamatkan oleh transisi `PROCESSING` / `COMPLETED` / `UNKNOWN_OUTCOME`.

## 10. Parsing Architecture
Disarankan di `src/date.ts`:
```typescript
interface DeadlineParseResult {
  kind: "none" | "resolved" | "needs_clarification";
  due?: string; // "YYYY-MM-DD"
  reason?: "missing_month" | "missing_weekday" | string;
  partial?: { date?: number; month?: number; year?: number };
  matchedText?: string;
}
function parseIndonesianDeadline(input: string, referenceDate: Date, timezone: "Asia/Jakarta"): DeadlineParseResult
```
Deadline di-*replace* dan dihapus dari `Cleaned Task Title`. Command tanpa deadline akan diproses tanpa atribut `Due` sama sekali.

## 11. Routing Precedence
1. Webhook Security validation
2. Telegram Authorization & Private Chat check
3. KV `update_id` Deduplication
4. Unsupported Media
5. `HELP` command (mengambil prioritas utama)
6. **Pending Clarification Continuation**:
   - Jika *command* bersifat eksplisit penuh (seperti "Tambah tugas", "Catat ide"), *pending state* akan **dibatalkan/dihapus** (cancel), diganti dengan rute command baru tersebut.
   - Jika bukan command baru, uji kecocokan terhadap jawaban klarifikasi.
7. Deterministic Parser (Task / Note / Memory commands)
8. Gemini Fallback

## 12. Security/Privacy
- State klarifikasi tersimpan sementara di KV tanpa bot token, raw update payload, atau API key.
- TTL di-set maksimum 15 menit.
- Diagnostics / logs tidak memuat kredensial, mengikuti standar privasi V1.

## 13. Test Strategy & Detailed Test Matrix
Referensi = Monday 2026-08-31 Asia/Jakarta

| Skenario | Input Text | Expected Result / Semantic |
|---|---|---|
| Bare Weekday (+7) | "deadline senin" | Due = 2026-09-07 |
| Bare Weekday (+1) | "deadline selasa" | Due = 2026-09-01 |
| Next Week Weekday | "deadline selasa depan" | Due = 2026-09-08 (+8 hari) |
| Next Week Weekday | "deadline senin depan" | Due = 2026-09-07 (+7 hari) |
| Missing Weekday | "deadline minggu depan" | State Needs Clarification, bot nanya "Hari apa minggu depan?", NO Notion write. |
| Resolve Weekday | Pending "minggu depan" -> "Kamis"| Due = 2026-09-10 (Dalam calendar week minggu depan). |
| Missing Month | "tanggal 5" | needs_clarification, NO Notion write. |
| Resolve Month | Pending "tanggal 5" -> "September" | State berubah ke PROCESSING sebelum pemanggilan Notion. |
| Notion 2xx Success | Pemanggilan Notion 200 OK | State berubah ke COMPLETED (tombstone). |
| Notion 400 Rejection | Notion 400 Validation Error | State revert ke READY, *retry permitted*. |
| Notion 403 Rejection | Notion 403 Permission Error | State revert ke READY, *retry permitted*. |
| Notion 500 Unknown | Notion 500 Server Error | State menjadi UNKNOWN_OUTCOME, NO automatic retry. |
| Fetch/Network Ex. | Exception Fetch Timeout | State menjadi UNKNOWN_OUTCOME, NO automatic retry. |
| Race Condition | User reply saat PROCESSING | Notion calls = 0 tambahan, dibalas "Tugas sedang diproses." |
| Unknown State Reply| User reply saat UNKNOWN_OUTCOME| Notion calls = 0 tambahan, dibalas "Status penyimpanan tugas belum dapat dipastikan..." |
| Repeat Clarification| User reply saat COMPLETED | Notion calls = 0 tambahan, dibalas "Tugas sudah tersimpan." |
| Telegram Dedupe | Duplicate `update_id` | Diproses sekali (ditangkal oleh `tg:<update_id>`). |
| Limitasi Transaksi | Menguji distributed atomic risk?| DOKUMENTASI SAJA, tidak membuat false unit-test guarantee atas batas transaksional tanpa marker. |
| Expired State | "September" (setelah 15mnt) | NO task write, fallback/abaikan. |
| Priority Check | "tugas x, prioritas tinggi, lusa"| Priority = High, Due = 2026-09-02, title = "tugas x" |
| Help Interruption | "/help" saat status pending | Menjalankan command `/help` biasa (tidak masuk klarifikasi). |
| Command Cancel | "Tambah tugas baru" | Pending task dibatalkan, membuat task baru. |

## 14. Notion Contract
Pada `createTask`, kirim `{"Due": { "date": { "start": due } }}` apabila tanggal resolved ada. Jangan mengirim struktur objek Date/Due jika kosong.

## 15. Acceptance Criteria
- Keseluruhan matriks uji diimplementasi dan PASS di `test/` secara deterministik.
- Mekanisme dedupe `update_id`, *tombstone* statis, dan pencegahan duplikasi *Unknown Outcome* bekerja secara harmonis.
- Batas transaksi Cloudflare KV vs Notion dihormati dan dipahami sesuai spesifikasi.
- Baseline V1 yang telah ada (8 files / 59 tests) lulus total saat rilis akhir (zero regression).
- Tidak ada crash / OOM selama verifikasi iterasi.
