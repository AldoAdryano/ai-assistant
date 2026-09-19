# Projects Link v1 — Tasks ↔ LIFE OS Projects

## Goal
Youyou dapat **menautkan Tasks operasional ke database Projects di LIFE OS**, supaya create/update/briefing/daftar tugas memahami “rumah” project (mis. Laundry ∈ Persiapan IKN), tanpa mengubah peran LIFE OS sebagai lapisan strategis.

## Context (from Notion printouts)
- **Youyou | Personal AI** — Inbox, Tasks, Memory, Rutinitas (operasi harian).
- **LIFE OS** — Goals, Projects, Learning, Finance, Health, Career, Reflection (arah).
- Mapping yang sudah tertulis di LIFE OS: target besar → Goals; project → Projects; tugas → Tasks Youyou.
- Tabel Tasks saat print: Task, Due, Priority, Source, Status — **belum ada relation ke Projects**.

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Tautan | **A** — property **Relation** di Tasks → DB Projects |
| Assign saat create | **A** — tebak dari konteks; jika ragu/ambigu → tanya dulu (selaras Brain v1) |
| Implementasi | Worker baca Projects + tulis relation; setup Notion manual sekali |
| Scope chat | DM path Notion (sama seperti task tools sekarang); grup tetap tidak tulis Notion pribadi |
| Deploy | Worker + secret baru; bridge tidak wajib |

## Notion setup (manual, sekali)
1. Buka database **Tasks** (Youyou).
2. Tambah property **Relation** bernama `Project` (atau `Projects` — spek kode akan pakai nama yang dikonfigurasi; default **`Project`**).
3. Target: database **Projects** di LIFE OS.
4. Pastikan integration Youyou (Notion connection yang dipakai Worker) punya akses ke **Tasks** dan **Projects**.
5. Salin **data source id** database Projects → Worker secret `NOTION_PROJECTS_DATA_SOURCE_ID`.

Optional (bukan blocker v1): di Projects, biarkan relation balik “Tasks” muncul otomatis.

## Data model (Worker)

```ts
type ProjectRecord = {
  id: string;
  name: string; // title property "Project"
  area?: string | null;
  status?: string | null; // if present on Projects; else omit
};

// Extend TaskRecord
type TaskRecord = {
  id: string;
  task: string;
  status: "To Do" | "Doing" | "Done";
  priority: Priority;
  due?: string;
  projectId?: string | null;
  projectName?: string | null;
};
```

## Behavior

### Match project (shared helper)
- Input: user/model string (nama project) + list `ProjectRecord[]`.
- Exact / case-insensitive / contains match on `name`.
- **0 matches** → clarify (daftar 3–5 project aktif) atau create task **tanpa** project jika user bilang “tanpa project”.
- **1 clear match** → use that id.
- **≥2 ambiguous** → clarify, do not pick silently.

### Create / update task
- Extend `create_notion_task` (and update if cheap) with optional `project` string or `projectId`.
- Gemini: if context clearly implies a known project, pass it; if unsure, ask before create (Brain clarify).
- Notion write: set Relation `Project` to `[{ id: projectPageId }]`.

### Read / list / briefing
- When listing active tasks, resolve relation → `projectName` for prompt/briefing.
- Task Intelligence briefing: prefer grouping lines by project when `projectName` present; unassigned under “Tanpa project”.
- Do not invent projects not in the Projects DB.

### Out of scope (v1)
- Create/edit/delete **Projects** pages from chat
- Goals ↔ Projects tooling
- Learning / Finance / Health / Career / Reflection writes
- Auto-create project when name unknown
- Group WhatsApp Notion writes

## Architecture
```
DM → Router → Gemini tools
              ├─ list projects (helper / optional tool read_projects)
              ├─ create_notion_task(+ project relation)
              └─ read tasks (include projectName)

Cron briefing → selectBriefingTasks → include project labels in generateTaskBriefing
```

## Files (expected)
| File | Change |
|------|--------|
| Notion UI | Relation `Project` on Tasks |
| `wrangler` / secrets | `NOTION_PROJECTS_DATA_SOURCE_ID` |
| `src/config.ts` / `src/types.ts` | config + `ProjectRecord` / extend `TaskRecord` |
| `src/notion.ts` | listProjects, map relation on list/create task |
| `src/gemini.ts` | tool args + prompt rules for project match/clarify |
| `src/router.ts` | wire if new tool; pass projects into context if needed |
| `src/task-intelligence` / briefing prompt | optional group-by project |
| `test/*` | match helper, create with relation, list mapping |

## Success criteria
1. Create task “laundry… IKN” → relation ke project yang cocok (atau tanya jika ambigu).
2. `briefing` / daftar tugas menampilkan nama project bila ada.
3. Task tanpa project tetap valid.
4. Brain / Memory / Context / Task Intelligence anti-nag tidak regresi.
5. Tanpa `NOTION_PROJECTS_DATA_SOURCE_ID` → Worker tetap jalan; project features soft-disable (log + ignore project args).

## Testing
Unit tests with mocked Notion fetch. Manual DM after Notion relation + secret + `wrangler deploy`.

## Deploy
1. Notion relation + share integration  
2. `wrangler secret put NOTION_PROJECTS_DATA_SOURCE_ID`  
3. `npx wrangler deploy`
