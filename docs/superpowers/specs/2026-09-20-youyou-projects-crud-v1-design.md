# Projects CRUD v1 — Create / Update / Delete LIFE OS Projects via Youyou

## Goal
Youyou dapat **membuat, mengubah, dan menghapus** halaman di database LIFE OS **Projects** dari DM, melengkapi Projects Link (Tasks ↔ Project), tanpa cascade menghapus task.

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Scope | Buat + update field dasar + hapus (A+B) |
| Hapus + task tertaut | **B** — arsip project saja; task tetap; relation Project pada task jadi kosong |
| Hapus safety | Selalu konfirmasi ya/jangan (pola Brain pending-delete) |
| Duplikat nama | Exact match case-insensitive → tanya sebelum create dobel |
| Deploy | Worker only; butuh `NOTION_PROJECTS_DATA_SOURCE_ID` (sudah ada) |

## Notion properties (Projects LIFE OS)
Dari print LIFE OS: **Project** (title), **Area**, **Deadline**, **GitHub**, **Goal**, **Output**.

**v1 tulis/baca:**
- `Project` (title) — wajib saat create
- `Area` (select/text — map sesuai tipe aktual di Notion; prefer select name string jika select)
- `Deadline` (date) — opsional

**v1 tidak wajib:** GitHub, Goal relation, Output (boleh diabaikan).

## Tools (Gemini, DM only)

### `create_notion_project`
Args: `name` (required), `area?`, `deadline?` (natural / ISO date).  
Behavior: if exact-ci name already exists → reply clarify, do not create. Else create page under Projects data source.

### `update_notion_project`
Args: `project` (name or id to match), `new_name?`, `area?`, `deadline?`.  
Use `matchProject`; none/ambiguous → clarify. Patch properties that were provided.

### `delete_notion_project`
Args: `project` (name or id).  
Do **not** archive immediately: save pending delete (kind `project`) with page id(s); ask ya/jangan. On ya → `archive` page (same Notion DELETE/blocks pattern as tasks). Tasks stay; Notion clears broken relations automatically when target archived.

## Pending delete
Extend `PendingDelete.kind` with `"project"` (reuse KV `pending_delete:${userId}`, freshness 10 min, phrases ya/jangan).  
Confirm handler: if kind project → archive project page id(s); label “project”.

## UX flows
1. **Mars flow:** create task mentions unknown project → current reject + list → optionally “mau kubuatkan project X?” (prompt) → user ya → `create_notion_project` → user retries task (or auto-offer create then task in same turn if model does both after confirm — v1: create project tool + user can re-ask task).
2. **Explicit:** “buat project Portfolio Embedded area Belajar deadline bulan depan”.
3. **Rename:** “ubah nama project Persiapan IKN jadi Persiapan IKN 2026”.
4. **Hapus:** “hapus project Liburan Mars” → konfirmasi → arsip.

## Soft-disable
If `notionProjectsDataSourceId` null: do not expose project CRUD tools; ignore calls.

## Files (expected)
| File | Change |
|------|--------|
| `src/notion.ts` | `createProject`, `updateProject`, `archiveProject` |
| `src/action-safety.ts` / `state` | `PendingDelete.kind` includes `project` |
| `src/gemini.ts` | three tools + prompt rules |
| `src/router.ts` | tool handlers + pending confirm branch |
| `test/*` | create dup, update match, delete confirm, soft-disable |

## Non-goals
- Goals CRUD / Goal relation on Projects
- Cascade archive tasks
- Create project from group chat
- Full GitHub/Output editing UI

## Success criteria
1. “buat project X” → page appears in LIFE OS Projects.
2. Duplicate exact name → no silent double create.
3. Update rename/area/deadline works via match.
4. Delete requires ya; after archive, tasks remain without that project link.
5. Unknown project on task create still rejects; user can create project then attach.

## Testing
Unit tests mocked Notion. Manual DM after deploy.

## Deploy
`npx wrangler deploy` (secret Projects already set).
