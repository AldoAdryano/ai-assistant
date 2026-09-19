# Youyou Brain v1 — Intent + Action Safety

## Goal
Youyou memutuskan *ke mana* informasi masuk (Task / Inbox / Memory / Routine / chat / tanya dulu), bukan langsung menembak tool Notion. Target utama: kasus “Simurelay jadi 4 task” dan hapus agresif tanpa konfirmasi.

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Fase | Brain v1 saja (V1.1 Intent + Action Safety ringan) |
| Policy default | **B** — task jelas → langsung; ambigu/multi → tanya; hapus/merge → selalu konfirmasi |
| Implementasi | **C** Hybrid — aturan kode untuk safety + Gemini untuk klasifikasi intent |
| Deploy | Worker only (`wrangler deploy`); bridge HP tidak wajib |

## Intents (V1)

| Intent | Aksi Notion |
|--------|-------------|
| `task` | `create_notion_task` / update terkait |
| `inbox` | `create_notion_note` (ide / “catat dulu”) |
| `memory` | `create_notion_memory` |
| `routine` | `create_routine` |
| `chat` | Tidak ada tool DB |
| `clarify` | Teks tanya saja; **tidak** memanggil tool create/delete |

Goals / Project sebagai intent tersendiri **di luar V1** (belum ada DB/schema baru).

## Policy B (detail)

1. **Keyakinan tinggi + satu aksi jelas** → langsung (contoh: “buat tugas laprak kendali deadline besok jam 8”).
2. **Ambigu / multi-item mungkin** → `clarify` (contoh burst beberapa pesan satu topik Simurelay → tanya “satu atau beberapa tugas?”).
3. **Hapus massal / ALL / multi-delete** → selalu konfirmasi sebelum archive (ditegakkan di kode).
4. **Satu batch pesan** (hasil buffer bridge 2.5s yang sudah ada) = **satu** keputusan, bukan N create otomatis.
5. **Merge / “ubah besar”** → di V1 hanya lewat aturan prompt (belum ada tool merge tersendiri); jangan invent tool baru.

## Architecture (Hybrid C)

```
WhatsApp → Bridge (buffer burst) → Worker router
                                      │
                    ┌─────────────────┴─────────────────┐
                    │  Gemini (prompt Brain rules)      │
                    │  pilih intent + tool / teks tanya │
                    └─────────────────┬─────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │  Router Action Safety (kode)      │
                    │  - burst/multi-create guard       │
                    │  - delete confirm gate            │
                    │  - clarify short-circuit          │
                    └─────────────────┬─────────────────┘
                                      │
                                   Notion
```

- **Gemini:** aturan intent + “jangan over-create” di system prompt (`src/gemini.ts`). Tidak wajib tool `classify_intent` terpisah di V1.
- **Router:** hard guard yang model tidak bisa bypass (`src/router.ts`).
- **Bridge:** tidak berubah untuk V1 (buffer burst sudah ada).

## Action Safety (kode)

### 1. Burst / multi-create guard
Dalam **satu** giliran tool-call (satu user turn setelah Gemini):
- Jika model mengeluarkan **lebih dari 1** `create_notion_task` tanpa sinyal eksplisit user bahwa itu beberapa tugas terpisah → **jangan** create semua.
- Router menahan create ekstra dan mengembalikan pesan klarifikasi ke model/user (gaya Youyou), mis. minta konfirmasi “satu atau beberapa?”.
- Sinyal “eksplisit beberapa”: user menyebut jumlah/daftar terpisah jelas (contoh: “buat 3 tugas: A, B, C” atau bullet terpisah dengan judul berbeda yang jelas diminta sebagai tugas masing-masing). Tanpa itu, default **satu** create atau clarify.

### 2. Delete confirm gate
Untuk `delete_notion_tasks`, `delete_notion_notes`, `delete_notion_memory` (dan keyword `ALL` / mass delete):
- **Pertama kali** di turn tanpa konfirmasi user → **jangan** `archiveTask`. Balas tanya konfirmasi (jumlah + ringkas apa yang akan dihapus bila diketahui).
- Konfirmasi positif di turn berikutnya (“ya”, “hapus”, “yakin”, dll. dalam konteks pending delete) → baru jalankan archive.
- Pending confirm disimpan di chat/KV state singkat per chat (reuse pola interaction/chat log yang ada bila memungkinkan; jangan DB Notion baru).

### 3. Clarify short-circuit
Jika Gemini membalas teks klarifikasi **tanpa** function calls → router tidak memaksa tool. Jangan “menebak” create di belakang layar.

### 4. Read tetap low-risk
`read_notion_tasks` / `read_notion_notes` / memory read → langsung, tanpa konfirmasi.

## Prompt Brain rules (ringkas, untuk `gemini.ts`)
Tambahkan aturan DM (bukan grup) yang menegaskan:
- Klasifikasikan dulu: task / inbox / memory / routine / chat / clarify.
- Jangan create Notion untuk obrolan/pertanyaan biasa.
- Beberapa pesan/satu topik tanpa daftar tugas terpisah yang jelas → satu task **atau** tanya; dilarang spam create.
- Hapus/merge: tanya konfirmasi dulu (selaras dengan gate kode).
- Task + deadline jelas tetap langsung create (policy B).
- Parallel multi-tool **hanya** jika user jelas minta aksi berbeda (bukan multi-create spekulatif dari satu topik).

Grup: aturan grup yang ada tetap; Brain v1 fokus DM/Notion path.

## Files
| File | Perubahan |
|------|-----------|
| `src/gemini.ts` | Brain rules di system prompt |
| `src/router.ts` | Burst guard, delete confirm, clarify short-circuit; helper state bila perlu |
| `test/router.test.ts` | Kasus multi-create, delete tanpa/dengan konfirmasi, chat tanpa create |
| Opsional kecil | Modul helper murni (mis. `src/action-safety.ts`) jika logika router terlalu panjang — boleh, jangan over-engineer |

## Non-goals (V1)
- DB Notion baru (Goals, Projects, Life OS schema)
- Context Manager penuh (topic switch state machine)
- Dashboard, finance, weekly review
- Proactive briefing baru (alarm/cron yang ada tetap)
- Bridge Termux / public `/stiker` changes
- Tool wajib `classify_intent` sebagai langkah terpisah

## Success criteria
1. Beberapa pesan satu topik (Simurelay-style) → **1** task atau klarifikasi “satu atau beberapa?”, **bukan** 4 create.
2. “Hapus semua tugas” tanpa konfirmasi → Youyou **tanya dulu**; belum archive.
3. Chat / pertanyaan biasa → **tidak** create Notion.
4. Task + deadline jelas → **langsung** buat (policy B tetap cepat).

## Testing
- Unit di `test/router.test.ts` dengan mock Gemini function_calls + deps Notion.
- Minimal: (a) 4× `create_notion_task` satu turn → ≤1 create atau clarify; (b) delete ALL tanpa confirm → 0 archive; (c) setelah confirm → archive; (d) text-only chat reply → 0 Notion writes.
- Tidak wajib E2E WhatsApp untuk merge V1.

## Deploy
`wrangler deploy` Worker. Verifikasi manual DM owner setelah deploy.
