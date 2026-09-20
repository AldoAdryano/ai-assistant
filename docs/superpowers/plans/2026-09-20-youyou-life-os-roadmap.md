# Youyou × LIFE OS — Roadmap pekerjaan sampai tuntas

> **Sumber arah:** `Rencana Sukses Mahasiswa Elektronika.pdf` + struktur Notion Youyou | Personal AI + LIFE OS (Sep 2026).  
> **Prinsip:** tiap fase menghasilkan Youyou yang bisa dipakai di DM; jangan bangun semua DB sekaligus.  
> **Hierarki inti:** Goal → Project → Task → Action (+ Review mingguan).

## Sudah tuntas (baseline)

| Lapisan | Capability | Status |
|---------|------------|--------|
| Otak operasional | Brain v1 (intent + safety) | ✅ |
| Memori jangka panjang | Memory 2.0 (Identity/Preference/Goal/Project/Pattern) | ✅ |
| Ganti topik | Context Manager v1 | ✅ |
| Briefing tugas | Task Intelligence v1 (Filter B + on-demand) | ✅ |
| Tasks ↔ Projects | Projects Link v1 | ✅ |
| CRUD Projects | Projects CRUD v1 | ✅ |
| Operasional DB | Inbox, Tasks, Rutinitas, Memory | ✅ (ada sebelumnya) |

## Definisi “tuntas”

Youyou bisa mendukung **Capture → Organize → Execute → Review** penuh:

1. Chat Aldo masuk ke DB yang benar (decision tree Notion).
2. **Goal → Project → Task** bisa dibuat, ditautkan, dibaca statusnya dari DM.
3. Skill / uang / kesehatan / karier / refleksi mingguan bisa dicatat & diringkas tanpa buka Notion tiap kali.
4. Minggu malam: satu alur Reflection yang selaras PDF (*Learned / Built / Income / Time Wasted / Improve*).

Bukan tuntas = bangun dashboard fancy atau passive-income engine. Youyou = **eksekutor + pengingat sistem hidup**, bukan pengganti usaha Aldo.

## Mapping PDF → Notion → fase Youyou

| Kompas PDF | DB Notion | Fase |
|------------|-----------|------|
| TARGET 12 bln / umur 23 | Goals | **1** |
| Project #1 Smart Room Monitor, portfolio | Projects (+ Tasks) | **1–2** (Projects sudah; status di 2) |
| Learn → Build harian | Tasks + Rutinitas | baseline ✅ |
| Skill stack Embedded/IoT/AI | Learning | **3** |
| Rp100rb pertama + catat uang | Finance | **4** |
| Olahraga / tidur | Health | **4** |
| Portfolio / evidence karier | Career | **5** |
| Review Minggu malam | Reflection | **5** (bisa digeser naik jika mau) |
| “Siapa Aldo” | Memory | baseline ✅ |

## Urutan fase (rekomendasi)

Kerjakan **berurutan**. Jangan lompat ke Finance sebelum Goal↔Project hidup — PDF menekankan arah dulu, baru mesin uang.

### Fase 0 — Seed data (manual, 30–60 menit, tanpa kode) ✅ DONE (2026-09-20)

Seed yang dipakai:
- Goal *Menguasai Embedded + IoT* (Area Karier, In progress, Progress 0%)
- Project *Smart Room Monitor* → Goal di atas (Projects `346b92a6-…`)
- Task *Rancang arsitektur Smart Room Monitor v1* → project itu
- Goals data source id disiapkan untuk secret Worker (lihat spek Goals Link)

---

### Fase 1 — Goals Link v1 *(prioritas berikutnya)*

**Tujuan:** Youyou memahami & menulis tulang punggung strategi.

| Item | Isi |
|------|-----|
| Notion (manual) | Secret `NOTION_GOALS_DATA_SOURCE_ID`; pastikan Projects.Goal relation ke Goals |
| Baca | `listGoals`, enrich project dengan `goalName` |
| Tulis | create/update goal (field: Goal, Area, Metric, Progress, Status, Target Date, Notes) |
| Taut | create/update project boleh set `goal`; match goal mirip `matchProject` |
| UX | “Aku ingin menguasai IoT tahun ini” → Goal; “buat project Smart Room Monitor untuk goal …” → Project+Goal |
| Soft-disable | Tanpa secret Goals → fitur goal off; Projects CRUD tetap |
| Non-goals v1 | Hapus goal cascade; Progress auto dari % task; Learning/Finance |

**Definition of done:** DM create goal + link project ke goal + tanya klarifikasi jika nama goal ambigu; tes unit + deploy.

---

### Fase 2 — Project Intelligence v1

**Spek:** `docs/superpowers/specs/2026-09-20-youyou-project-intelligence-v1-design.md`

**Keputusan v1:** scope baca + briefing group; status = To Do+Doing saja; tools + format router; **tanpa** Mars polish / Done list.

| Item | Isi |
|------|-----|
| UX | “status project …”, “daftar project”, “task di project X” |
| Data | Project fields + open tasks + goalName bila ada |
| Briefing | Group deterministik di kode sebelum Gemini (Filter B + cap tetap) |

**Definition of done:** status/daftar akurat; briefing terkelompok; soft-disable; regresi CRUD.

---

### Fase 3 — Learning Link v1

**Tujuan:** skill stack PDF hidup di chat.

| Item | Isi |
|------|-----|
| Notion | Secret Learning data source |
| UX | “saya lagi belajar MQTT”, “naikkan level Python”, “skill apa yang in progress?” |
| Aturan Brain | *Belajar 30 menit malam ini* → Task; *Python sebagai skill* → Learning |
| Fields | Skill, Area, Level, Status, Target, Resource, Last Practiced |

**Definition of done:** beda jelas Learning vs Task di prompt + 1–2 tes regression Brain.

---

### Fase 4 — Finance + Health capture v1

**Tujuan:** dua kebiasaan PDF yang sering terlewat: uang & tubuh.

Kerjakan sebagai **satu spek** atau dua mini-spek berurutan (Finance dulu jika income experiment 30 hari aktif).

| Domain | UX contoh | Aturan |
|--------|-----------|--------|
| Finance | “makan 15rb”, “dapet 100rb jasa website” | Jangan jadi Task; Entry/Amount/Category/Type/Date |
| Health | “workout strength, tidur 7 jam” | Jangan jadi Task kecuali “jadwalkan gym besok” |

**Definition of done:** catat expense/income + health entry dari DM; list/ringkas minggu ini (sederhana).

---

### Fase 5 — Career + Reflection v1

**Tujuan:** evidence karier + review Minggu malam (penutup loop PDF).

| Domain | UX | Catatan |
|--------|-----|---------|
| Career | “tambah evidence portfolio IoT: \<url\>” | Bukan dump semua task |
| Reflection | “review minggu ini” / cron opsional Minggu malam | Template: Learned, Built, Income, Time Wasted, Improve Next Week; Youyou boleh draft dari tasks/projects/finance lalu konfirmasi sebelum tulis |

**Definition of done:** satu Reflection tersimpan setelah konfirmasi; Career entry dengan evidence link.

---

### Fase 6 — LIFE OS Brain polish (opsional, setelah 1–5)

Perluas decision tree Brain untuk lapisan strategi (tanpa merusak anti-nag Context Manager):

- Ambigu strategi → Inbox atau clarify, bukan 5 task acak.
- “Mau bikin Smart Room Monitor” → Project (bukan burst tasks).
- Soft weekly nudge Reflection jika Fase 5 ada (hormati Context Manager: jangan nge-nag di tengah resep/obrolan).

## Cara eksekusi tiap fase (pola tetap)

Untuk **setiap** fase di atas:

1. Brainstorm singkat (1–2 keputusan) → spek `docs/superpowers/specs/YYYY-MM-DD-…-design.md`
2. Plan implementasi `docs/superpowers/plans/…`
3. Subagent-driven / TDD → merge `main` → `wrangler deploy`
4. Uji DM checklist 3–5 pesan
5. Baru mulai fase berikutnya

Jangan gabung Fase 1+4 dalam satu PR.

## Perkiraan urutan kalender (kasar)

Asumsi: 1 fase inti / sesi fokus (bukan hari kalender kaku).

| Urutan | Fase | Effort relatif |
|--------|------|----------------|
| Sekarang | Fase 0 seed Notion | kecil |
| Next | Fase 1 Goals Link | sedang |
| Lalu | Fase 2 Project Intelligence | sedang |
| Lalu | Fase 3 Learning | sedang |
| Lalu | Fase 4 Finance + Health | sedang–besar |
| Lalu | Fase 5 Career + Reflection | sedang |
| Akhir | Fase 6 polish | kecil–sedang |

## Di luar roadmap ini

- Duplikat DB Projects di LIFE OS (bersihkan manual)
- Passive income / investasi otomatis
- Dashboard Notion visual / wallpaper roadmap 19–23
- Bridge Termux / Bad MAC (ops terpisah)
- Group chat menulis LIFE OS

## Keputusan terkunci

1. **Reflection** — tetap **Fase 5** (tidak dinaikkan).
2. Eksekusi **satu fase per cycle** (spek → plan → implement → deploy → uji DM).

## Keputusan yang masih perlu dikunci di awal Fase 1

1. **Goals data source id** — Aldo salin dari Notion (seperti Projects).
2. **CRUD Goals di v1?** Rekomendasi: **create + update** dulu; delete + confirm belakangan (sama pola Projects jika perlu).

## Next action

1. **Fase 0** — seed Notion (manual) bila belum.
2. Brainstorm + spek **Fase 1 Goals Link v1**.
