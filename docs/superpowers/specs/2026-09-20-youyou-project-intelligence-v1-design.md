# Project Intelligence v1 — Status, daftar project, briefing grouped

## Goal
Youyou dapat **membaca** keadaan LIFE OS Projects dari DM (status satu project, daftar project, task terbuka per project) dan **mengelompokkan briefing** Filter B per project secara deterministik — tanpa mengubah CRUD Projects/Goals.

## Context
- Projects Link + CRUD + Goals Link sudah live (Goal → Project → Task).
- Briefing Task Intelligence sudah label `[projectName]` dan minta model “kelompokkan natural”; v1 mengeraskan grouping di **kode** sebelum Gemini.
- Roadmap: `docs/superpowers/plans/2026-09-20-youyou-life-os-roadmap.md` Fase 2 (scope **B** = baca + briefing group; tanpa Mars polish).

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Scope | **B** — status + daftar project + task di project + grouping briefing |
| Task di status | **A** — hanya To Do + Doing (tanpa hitungan Done, tanpa list Done) |
| Pendekatan | Tools + format balasan di router (bukan prompt-only) |
| Briefing group | Format daftar tugas **sudah terkelompok di kode**; Gemini hanya merangkai gaya Youyou |
| Deploy | Worker only; butuh `NOTION_PROJECTS_DATA_SOURCE_ID` (sudah ada) |

## UX
1. “status project Smart Room Monitor” / “progress project …” / “gimana project X”
2. “daftar project” / “project apa saja”
3. “task di project X” → list task terbuka project itu (boleh sama sumber data dengan status, fokus list)

Ambiguous / unknown project name → clarify via `matchProject` (daftar kandidat / project yang ada).

## Tools (Gemini, DM only, `projectsEnabled`)

### `list_notion_projects`
No required args (optional soft filters later — **v1: none**).  
Router: `listProjects` → format ringkas (nama, area?, status? bila ada di record, goalName?, deadline? bila sudah di `ProjectRecord`).

### `get_project_status`
Args: `project` (name or id).  
`matchProject`; none/ambiguous → clarify, no invent.  
On one: load open tasks for that `projectId` (To Do + Doing only) → **router-formatted** reply (deterministic), not free-form model inventing tasks.

Optional: model may call this for “task di project X”; same handler / same formatter.

## Data
- Projects: existing `listProjects` / `ProjectRecord` (incl. `goalId`/`goalName` when Goals configured).
- Tasks: existing active-task list filtered by `projectId` (or Notion filter if cheap; v1 may filter in memory from `listActiveTasks`).
- Do **not** include Done in status body.

## Briefing
In `generateTaskBriefing` (cron + on-demand):
1. Build `taskData` string **grouped by** `projectName` (missing → `Tanpa project` last).
2. Keep Filter B selection + cap unchanged (`selectBriefingTasks`).
3. Prompt: instruct model to follow the supplied grouping; do not reorder across projects or invent tasks.

## Soft-disable
If `notionProjectsDataSourceId` null: do not expose these tools; ignore calls; briefing falls back to current label behavior without requiring Goals.

## Architecture
```
DM → Router → Gemini
              ├─ list_notion_projects
              └─ get_project_status (+ matchProject + format)

Cron/DM briefing → selectBriefingTasks → formatGroupedByProject → generateTaskBriefing
```

## Files (expected)
| File | Change |
|------|--------|
| `src/project-intelligence.ts` (or similar) | `formatProjectStatus`, `formatProjectList`, `groupTasksByProject` pure helpers |
| `src/gemini.ts` | tools + briefing grouped input |
| `src/router.ts` | tool handlers |
| `test/*` | helpers, router, briefing grouping |

## Non-goals
- Mars polish (auto-retry task after “buatin”)
- List/count Done tasks in status
- Auto Progress on Goals from % Done
- Learning / Finance / Health / Career / Reflection
- Changing Filter B window or 07/18 slots
- Group chat project status

## Success criteria
1. “status project Smart Room Monitor” → nama + meta + hanya task To Do/Doing tertaut (akurat vs Notion).
2. “daftar project” → list dari LIFE OS Projects (bukan invent).
3. Unknown/ambiguous project → clarify.
4. Briefing on-demand/cron: tasks visually/logically grouped by project in the model input (and thus replies).
5. Soft-disable without Projects secret.
6. No regression: Projects CRUD, Goals Link, Brain delete, Memory 2.0, Filter B selection rules.

## Testing
Unit tests for formatters + match wiring + briefing group string. Manual DM after deploy.

## Deploy
`npx wrangler deploy` (Projects secret already set).

## Uji DM (setelah live)
1. `daftar project`
2. `status project Smart Room Monitor`
3. `task di project Portfolio ESP32` (atau project yang ada)
4. `briefing` — cek grouping per project
5. Regression: `buat task … untuk Smart Room Monitor` masih link
