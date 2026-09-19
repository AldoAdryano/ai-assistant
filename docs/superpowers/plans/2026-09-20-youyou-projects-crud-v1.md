# Projects CRUD v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Youyou create, update, and archive LIFE OS Projects pages from DM (with delete confirmation), without cascading task deletes.

**Architecture:** Notion helpers `createProject` / `updateProject` / `archiveProject`; extend `PendingDelete.kind` with `"project"`; Gemini tools `create_notion_project` / `update_notion_project` / `delete_notion_project` (DM only when Projects configured); router handlers + confirm branch that archives projects instead of tasks.

**Tech Stack:** Cloudflare Worker TypeScript, Notion data_source pages API, Vitest, existing pending-delete KV pattern.

**Spec:** `docs/superpowers/specs/2026-09-20-youyou-projects-crud-v1-design.md`

## Global Constraints
- Requires `config.notionProjectsDataSourceId`; soft-disable CRUD tools/handlers when null.
- Projects title property: **`Project`**. Area = Notion **select** (same as `listProjects` read). Deadline = **date**.
- Delete: always pending confirm; archive project page only; tasks remain (relation clears in Notion).
- Duplicate create: exact case-insensitive name → no create, ask user.
- Do not regress Projects Link task attach / Mars reject / Brain delete flows.
- Deploy: Worker only.

## File map
| File | Responsibility |
|------|----------------|
| `src/notion.ts` | create/update/archive project |
| `src/action-safety.ts` | `PendingDelete.kind` += `"project"` |
| `src/gemini.ts` | three tools + rules; gate tools when no projects config… **Note:** gemini may not have config.projects id — gate in router by ignoring tools / or pass `projectsEnabled` flag into generateChatReply. Prefer: always declare tools when DM; router no-ops if disabled (same as create task project arg). Spec: do not expose when null — pass `projectsEnabled` boolean into `generateChatReply` context. |
| `src/router.ts` | handlers + confirm archiveProject |
| `test/notion-projects.test.ts` | CRUD Notion payloads |
| `test/router.test.ts` | create dup, update, delete confirm |
| `test/pending-delete-state.test.ts` or action-safety | kind project label if needed |

---

### Task 1: Notion create/update/archive project (TDD)

**Files:**
- Modify: `src/notion.ts`
- Modify: `test/notion-projects.test.ts`

**Interfaces:**
```ts
export async function createProject(
  config: AppConfig,
  project: { name: string; area?: string; deadline?: string },
  fetchImpl?: typeof fetch,
): Promise<string>;
// Throws NotionRejectionError if !notionProjectsDataSourceId
// Properties: Project title; Area select if area; Deadline date if deadline (via normalizeNotionDue)

export async function updateProject(
  config: AppConfig,
  pageId: string,
  update: { name?: string; area?: string; deadline?: string },
  fetchImpl?: typeof fetch,
): Promise<void>;

export async function archiveProject(
  config: AppConfig,
  pageId: string,
  fetchImpl?: typeof fetch,
): Promise<void>;
// Same as archiveTask: DELETE /blocks/{id}
```

**Helper (optional export for router):**
```ts
export function findExactProjectName(name: string, projects: ProjectRecord[]): ProjectRecord | null;
// case-insensitive exact equality
```
Can live in `project-match.ts` as `findExactProject(name, projects)`.

- [ ] Tests: create body has title + optional Area/Deadline; update PATCH; archive DELETE; create throws/soft when no data source id
- [ ] Commit: `feat: Notion create/update/archive for Projects`

---

### Task 2: PendingDelete kind `project` (TDD)

**Files:**
- Modify: `src/action-safety.ts` — `kind: "tasks" | "notes" | "memory" | "project"`
- Modify: `src/router.ts` — `deleteKindLabel`: project → `"project"`; confirm loop:

```ts
for (const id of pending.ids) {
  try {
    if (pending.kind === "project") await deps.archiveProject(config, id);
    else await deps.archiveTask(config, id); // existing notes/memory/tasks paths — VERIFY current code: today ALL kinds use archiveTask!
  }
}
```

**CRITICAL:** Inspect current confirm handler — notes/memory deletes also use `archiveTask` today which may be wrong historically OR notes use same DELETE blocks API. Keep existing behavior for non-project kinds; only branch `project` → `archiveProject` (identical HTTP DELETE is fine — can alias `archiveProject = archiveTask` implementation-wise, but call `archiveProject` for clarity / deps injection).

Wire `archiveProject` on `RouterDeps`.

- [ ] Test: pending kind project + “ya” calls `archiveProject` not createTask; label “project”
- [ ] Commit: `feat: pending-delete support for projects`

---

### Task 3: Gemini tools + projectsEnabled gate (TDD)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Interfaces:**
- Context: `projectsEnabled?: boolean` (true when DM && config has projects id — set by router)
- When `projectsEnabled` and not group, add tools:
  - `create_notion_project` `{ name, area?, deadline? }`
  - `update_notion_project` `{ project, new_name?, area?, deadline? }`
  - `delete_notion_project` `{ project }`
- Prompt rules: CRUD only for LIFE OS Projects; delete always needs user confirm via tool (model calls delete tool; system asks ya); do not invent Goals; after creating project user may attach tasks.

- [ ] Test: tools present when projectsEnabled; absent when false/group
- [ ] Commit: `feat: Gemini tools for Projects CRUD`

---

### Task 4: Router tool handlers (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**create_notion_project:**
1. If !projectsEnabled → “Projects belum dikonfigurasi.”
2. `listProjects` → if `findExactProject(name)` → “Project 'X' sudah ada. Pakai itu atau pilih nama lain.”
3. Else `createProject`; reply success.

**update_notion_project:**
1. matchProject(args.project); none/ambiguous → clarify
2. `updateProject(id, { name: new_name, area, deadline })`
3. Success message

**delete_notion_project:**
1. matchProject; none/ambiguous → clarify
2. `savePendingDelete({ kind: "project", ids: [id], summary: name, createdAt })`
3. Reply: `Aldo, yakin hapus project X? Task di dalamnya tidak ikut terhapus. Balas "ya" atau "jangan".`

Pass `projectsEnabled: Boolean(config.notionProjectsDataSourceId)` into `generateChatReply`.

Also when Projects Link rejects unknown project, append hint: `Mau kubuatkan project itu dulu? Bilang "buat project …".` (one line in existing none-match message).

- [ ] Tests covering create, dup, update, delete pending, confirm ya → archiveProject, soft-disable
- [ ] Commit: `feat: wire Projects CRUD into router`

---

### Task 5: Verify + deploy

- [ ] `npx vitest run` PASS
- [ ] `npx wrangler deploy`
- [ ] Manual DM:
  1. `buat project Uji CRUD area Belajar`
  2. `ubah nama project Uji CRUD jadi Uji CRUD 2`
  3. `hapus project Uji CRUD 2` → ya
  4. `buat tugas foo untuk project Liburan Mars` → reject + hint buat project

---

## Spec coverage
| Item | Task |
|------|------|
| createProject + dup check | 1 + 4 |
| updateProject | 1 + 4 |
| delete + confirm + archive | 2 + 4 |
| Area select / Deadline date | 1 |
| Soft-disable | 3 + 4 |
| Mars hint | 4 |
| No cascade tasks | 4 copy + archive only project |
| Deploy | 5 |
