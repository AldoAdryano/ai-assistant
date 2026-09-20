# Learning Link v1 — LIFE OS Learning CRUD + Brain boundary

## Goal
Youyou dapat **membuat, membaca, mengubah, dan mengarsip** skill di database LIFE OS **Learning** dari DM, dengan batas jelas vs Tasks: jadwal belajar → Task; skill/stack → Learning; **ragu → tanya**.

## Context
- Roadmap Fase 3: `docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md`
- Goals / Projects / Project Intelligence sudah live.
- LIFE OS Learning props (dari Notion print): Skill, Area, Level, Status, Target, Resource, Last Practiced.

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Scope tulis | **B** — create + list/status + update + delete |
| Hapus | Konfirmasi ya/jangan; archive page saja (`PendingDelete.kind = "learning"`) |
| Task vs Learning | **C** — jadwal eksplisit → Task; skill/stack eksplisit → Learning; **ragu → clarify** (jangan tebak) |
| Pendekatan | Mirror Goals Link (Notion + match + Gemini tools + router) |
| Deploy | Worker + secret `NOTION_LEARNING_DATA_SOURCE_ID` |

## Notion setup
1. Integration Youyou akses database **Learning**.
2. `wrangler secret put NOTION_LEARNING_DATA_SOURCE_ID` (nilai dari Aldo — isi saat deploy).
3. Title property: **`Skill`** (atau nama title aktual di Notion — konfirmasi di implementasi; default **Skill**).

## Properties (v1)
| Field | Notion | Write |
|-------|--------|-------|
| Skill | title | wajib create |
| Area | select/text | opsional |
| Level | number/text | opsional |
| Status | select (Not started / In progress / Done) | opsional |
| Target | text/rich_text | opsional |
| Resource | url/text/rich_text | opsional |
| Last Practiced | date | opsional |

Map tipe aktual saat implementasi (select vs rich_text) seperti Goals.

## Data model
```ts
type LearningRecord = {
  id: string;
  name: string; // Skill title
  area?: string | null;
  level?: string | number | null;
  status?: string | null;
  target?: string | null;
  resource?: string | null;
  lastPracticed?: string | null;
};

// AppConfig
notionLearningDataSourceId: string | null;
```

## Match
`matchLearning` / `findExactLearning` — semantik sama `matchProject` (exact-ci → unique contains → none/one/ambiguous; UUID id).

## Tools (Gemini, DM only, `learningEnabled`)

### `create_notion_learning`
Args: `name` (required), `area?`, `level?`, `status?`, `target?`, `resource?`, `last_practiced?`.  
Exact-ci duplikat → clarify, jangan create.

### `update_notion_learning`
Args: `skill` (name/id), `new_name?`, `area?`, `level?`, `status?`, `target?`, `resource?`, `last_practiced?`.

### `delete_notion_learning`
Args: `skill`. Pending confirm; copy: project/task tidak relevan — “yakin hapus skill X? Balas ya/jangan.”

### `list_notion_learning`
Args: optional `status?` (e.g. In progress). Router formats list (deterministic), short-circuit seperti project list.

## Pending delete
Extend `PendingDelete.kind` dengan `"learning"`.  
Confirm → `archiveLearning` (DELETE blocks). Soft-disable gate jika secret null.

## Soft-disable
Tanpa `notionLearningDataSourceId`: jangan expose tools; ignore calls; Task/Goals/Projects tetap.

## Brain / prompt rules
1. *“Belajar MQTT 30 menit malam ini”* / ada deadline/jadwal aksi → **Task** (boleh notes “MQTT”).
2. *“Saya lagi belajar MQTT”* / *“tambah skill Python”* / *“naikkan level …”* → **Learning**.
3. Ambigu → **clarify** satu pertanyaan: skill di Learning atau jadwalkan sebagai Task? Jangan create keduanya diam-diam.
4. Learning ≠ Memory category; ≠ Goals.

## UX examples
1. `tambah skill Python area Programming status In progress`
2. `naikkan level skill MQTT jadi 2` / `update last practiced MQTT hari ini`
3. `daftar skill` / `skill apa yang in progress?`
4. `hapus skill Obsolete X` → ya → archive

## Architecture
```
DM → Router → Gemini tools
              ├─ list/create/update/delete_notion_learning
              ├─ matchLearning
              └─ pending_delete kind learning
```

## Files (expected)
| File | Change |
|------|--------|
| `src/types.ts` / `config.ts` | LearningRecord + secret |
| `src/learning-match.ts` | match helpers |
| `src/notion.ts` | list/create/update/archive Learning |
| `src/action-safety.ts` | kind `learning` |
| `src/gemini.ts` | tools + Brain boundary rules |
| `src/router.ts` | handlers + confirm + normalize routing |
| `test/*` | match, Notion, Gemini gate, router CRUD/clarify |

## Non-goals
- Auto Level dari jumlah session
- Link Learning ↔ Projects/Goals
- Finance / Health / Career / Reflection (Fase 4–5)
- Group chat Learning writes
- Mars polish

## Success criteria
1. Create skill → page di LIFE OS Learning.
2. Dup exact name → no silent double.
3. Update level/status/last_practiced via match.
4. Delete butuh ya; archive only.
5. List/status deterministic.
6. Ambiguous “belajar …” → clarify, bukan auto Task+Learning.
7. Soft-disable tanpa secret; regresi Goals/Projects/PI/briefing.

## Testing
Unit mocked Notion. Manual DM setelah secret + deploy.

## Deploy
1. `npx wrangler secret put NOTION_LEARNING_DATA_SOURCE_ID`
2. `npx wrangler deploy`

## Uji DM
1. `tambah skill MQTT area Embedded status In progress`
2. `daftar skill` / `skill in progress`
3. `ubah level skill MQTT jadi 2`
4. Kalimat ambigu: `belajar python` → harus tanya Task vs Learning
5. Jadwal jelas: `belajar python 30 menit malam ini` → Task
6. `hapus skill MQTT` → ya
