# Goals Link v1 — LIFE OS Goals ↔ Projects (+ CRUD)

## Goal
Youyou dapat **membaca, membuat, mengubah, dan mengarsip** halaman di database LIFE OS **Goals**, serta **menautkan Projects → Goal**, melengkapi hierarki PDF/Notion: **Goal → Project → Task**. Hapus goal **tidak** mengarsip project.

## Context
- Fase 0 selesai (manual): Goal *Menguasai Embedded + IoT* → Project *Smart Room Monitor* → Task *Rancang arsitektur Smart Room Monitor v1*.
- Projects Link + CRUD sudah live; Tasks ↔ Projects sudah ada.
- Roadmap: `docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md` Fase 1.
- **Bukan** Memory category `Goal` (Memory 2.0 tetap untuk fakta jangka panjang tentang Aldo). LIFE OS Goals = target terukur dengan Area/Metric/Progress.

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Pendekatan | Mirror Projects Link + CRUD |
| Scope tulis | **B** — create + update + delete |
| Hapus + project tertaut | **B** — arsip goal saja; project tetap; relation Goal pada project jadi kosong |
| Hapus safety | Selalu konfirmasi ya/jangan (`PendingDelete.kind = "goal"`) |
| Duplikat nama | Exact match case-insensitive → tanya sebelum create dobel |
| Goal pada project | Opsional saat create/update project |
| Fase 0 | Selesai (seed Notion sudah ada) |
| Deploy | Worker + secret `NOTION_GOALS_DATA_SOURCE_ID` |

## Notion setup
1. Integration Youyou punya akses database **Goals** (+ Projects yang sudah ada).
2. Property **Goal** (relation) di Projects → DB Goals (sudah dipakai di Fase 0).
3. `wrangler secret put NOTION_GOALS_DATA_SOURCE_ID`  
   Nilai (dari Aldo, Fase 0): `07f9074e-d2cd-4f52-b855-69e4384c03d9`

## Notion properties (Goals)
Dari LIFE OS: **Goal** (title), **Area**, **Metric**, **Progress**, **Status**, **Target Date**, **Notes**.

**v1 tulis/baca:**
- `Goal` (title) — wajib saat create
- `Area` (select/text — map sesuai tipe aktual)
- `Metric` (text/number — map sesuai tipe aktual; prefer string yang aman)
- `Progress` (number atau text — map sesuai tipe aktual)
- `Status` (select: Not started / In progress / Done — nama opsi sesuai Notion)
- `Target Date` (date) — opsional
- `Notes` (text/rich text) — opsional

## Data model (Worker)

```ts
type GoalRecord = {
  id: string;
  name: string; // title "Goal"
  area?: string | null;
  metric?: string | null;
  progress?: string | number | null;
  status?: string | null;
  targetDate?: string | null;
  notes?: string | null;
};

// Extend ProjectRecord
type ProjectRecord = {
  id: string;
  name: string;
  area?: string | null;
  status?: string | null;
  goalId?: string | null;
  goalName?: string | null;
  // … existing deadline etc. as already implemented
};
```

Config: `notionGoalsDataSourceId: string | null` dari env `NOTION_GOALS_DATA_SOURCE_ID`.

## Match
- Helper `matchGoal` — sama semantik `matchProject` (exact-ci → unique contains → none / one / ambiguous; optional Notion UUID id match).
- Reuse atau parallel module (`goal-match.ts` atau generalize match-by-name); jangan pecah perilaku.

## Tools (Gemini, DM only)

### `create_notion_goal`
Args: `name` (required), `area?`, `metric?`, `progress?`, `status?`, `target_date?`, `notes?`.  
Exact-ci duplikat nama → clarify, jangan create.

### `update_notion_goal`
Args: `goal` (name or id), `new_name?`, `area?`, `metric?`, `progress?`, `status?`, `target_date?`, `notes?`.  
`matchGoal`; none/ambiguous → clarify.

### `delete_notion_goal`
Args: `goal` (name or id).  
Jangan archive langsung → `PendingDelete` kind `goal` → tanya ya/jangan → archive page. Projects tetap.

### Extend project tools
- `create_notion_project` / `update_notion_project`: optional arg `goal` (name or id).  
  Resolve via `matchGoal`; none/ambiguous → clarify (jangan create project tanpa konfirmasi goal jika user eksplisit sebut goal).  
  Jika user tidak sebut goal → project tanpa relation Goal (OK).

## Pending delete
Extend `PendingDelete.kind` dengan `"goal"`.  
Confirm: archive goal page id(s); label “goal”.  
Gate: jika kind goal dan `notionGoalsDataSourceId` null → clear pending, jangan archive.

## Soft-disable
Jika `notionGoalsDataSourceId` null:
- Jangan expose tools goal CRUD
- Jangan resolve/set goal pada project
- Projects Link/CRUD tetap jalan

## UX flows
1. “Aku ingin menguasai IoT tahun ini” / “buat goal …” → create goal.
2. “Ubah progress goal Menguasai Embedded + IoT jadi 10” → update.
3. “Hapus goal …” → konfirmasi → arsip; Smart Room Monitor tetap ada.
4. “Buat project X untuk goal Menguasai Embedded + IoT” → project + relation Goal.
5. Bedakan prompt: Memory category Goal ≠ LIFE OS Goals tools.

## Architecture
```
DM → Router → Gemini tools
              ├─ listGoals / matchGoal
              ├─ create/update/delete_notion_goal
              ├─ create/update_notion_project (+ optional goalId)
              └─ pending_delete kind goal
```

## Files (expected)
| File | Change |
|------|--------|
| `src/types.ts` / `src/config.ts` | `GoalRecord`, `notionGoalsDataSourceId`, ProjectRecord goal fields |
| `src/notion.ts` | `listGoals`, `createGoal`, `updateGoal`, `archiveGoal`; project create/update/list set/read Goal relation |
| `src/goal-match.ts` (or shared) | `matchGoal` (+ tests) |
| `src/action-safety.ts` | `PendingDelete.kind` includes `goal` |
| `src/gemini.ts` | goal tools + update project tool schema/prompt (boleh Goals LIFE OS; bedakan Memory) |
| `src/router.ts` | handlers + pending confirm + soft-disable gates |
| `test/*` | match, CRUD, project+goal link, delete confirm, soft-disable |

## Non-goals
- Auto Progress dari % task selesai
- Cascade archive projects/tasks
- Learning / Finance / Health / Career / Reflection
- Project Intelligence penuh (status ringkas) — Fase 2 roadmap
- Group chat menulis Goals
- Menghapus/mengubah Memory category `Goal`

## Success criteria
1. “buat goal X” → page di LIFE OS Goals.
2. Duplikat exact nama → tidak silent double create.
3. Update field goal via match berhasil.
4. Delete butuh ya; setelah arsip, project (mis. Smart Room Monitor) tetap; relation Goal kosong/broken cleared by Notion.
5. “buat project Y untuk goal Menguasai Embedded + IoT” → Projects.Goal terisi.
6. Tanpa secret Goals → Worker tetap jalan; goal tools off.
7. Regression: task↔project, project CRUD, Brain delete task, Memory 2.0 tidak rusak.

## Testing
Unit tests mocked Notion. Manual DM setelah secret + deploy, pakai seed Fase 0.

## Deploy
1. `npx wrangler secret put NOTION_GOALS_DATA_SOURCE_ID`  
2. `npx wrangler deploy`

## Uji DM (setelah live)
1. `buat goal Dapat income pertama dari skill area Income metric Rp100000`  
2. `ubah progress goal Menguasai Embedded + IoT jadi 5`  
3. `buat project Portfolio ESP32 untuk goal Menguasai Embedded + IoT`  
4. `hapus goal Dapat income pertama dari skill` → `ya` → cek project lain tidak ikut hilang
