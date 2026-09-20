# Project Intelligence v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Youyou list projects, return deterministic project status (open tasks only), and feed Filter-B briefing with code-grouped project sections.

**Architecture:** Pure helpers in `src/project-intelligence.ts`; extend `listProjects`/`ProjectRecord` with optional `status` + `deadline`; Gemini tools `list_notion_projects` + `get_project_status` (DM + `projectsEnabled`); router formats replies; `generateTaskBriefing` builds grouped `taskData` in code.

**Tech Stack:** Cloudflare Worker TypeScript, Vitest, existing `matchProject` / `listActiveTasks` / Task Intelligence briefing.

**Spec:** `docs/superpowers/specs/2026-09-20-youyou-project-intelligence-v1-design.md`

## Global Constraints
- Soft-disable tools when `!config.notionProjectsDataSourceId` (same gate as Projects CRUD).
- Status body: **To Do + Doing only** — never list Done; no Done count.
- Status/list replies are **router-formatted** (deterministic); model must not invent tasks/projects.
- Briefing: group in code before Gemini; Filter B selection + cap unchanged; “Tanpa project” last.
- No Mars polish, no Goals Progress auto, no Filter B window/slot changes.
- Do not regress Projects CRUD, Goals Link, Brain delete, Memory 2.0, briefing empty copy.

## File map
| File | Responsibility |
|------|----------------|
| `src/types.ts` | `ProjectRecord.status?`, `ProjectRecord.deadline?` |
| `src/notion.ts` | Map Status select + Deadline date in `listProjects` |
| `src/project-intelligence.ts` | `formatProjectList`, `formatProjectStatus`, `formatTasksGroupedByProject` |
| `src/gemini.ts` | tools + briefing uses grouped formatter |
| `src/router.ts` | handlers for list/status tools |
| `test/project-intelligence.test.ts` | pure formatter tests |
| `test/notion-projects.test.ts` | listProjects maps status/deadline |
| `test/gemini.test.ts` | tools gate + briefing grouped prompt |
| `test/router.test.ts` | list/status/clarify/soft-disable |

---

### Task 1: Pure formatters + ProjectRecord fields (TDD)

**Files:**
- Create: `src/project-intelligence.ts`
- Create: `test/project-intelligence.test.ts`
- Modify: `src/types.ts` — add optional `status?: string | null`, `deadline?: string | null` on `ProjectRecord`
- Modify: `src/notion.ts` `listProjects` map:
  - `status` from `page.properties?.Status?.select?.name`
  - `deadline` from `page.properties?.Deadline?.date?.start` (string if present)
- Modify: `test/notion-projects.test.ts` — assert status/deadline mapping when present in mock page

**Interfaces:**
```ts
export function formatProjectList(projects: ProjectRecord[]): string;
// Empty → "Belum ada project di LIFE OS."
// Else lines like: "• Smart Room Monitor — Area: IoT; Goal: Menguasai Embedded + IoT; Status: In progress; Deadline: 2026-12-01"
// Omit missing optional fields; always include name.

export function formatProjectStatus(
  project: ProjectRecord,
  openTasks: TaskRecord[],
): string;
// Header with name + optional area/status/deadline/goalName
// Then "Task terbuka:" or "Tidak ada task terbuka."
// Each open task: "- [Priority] title — due" (due optional)
// Caller passes only To Do/Doing; formatter does not filter Done (but must not assume Done present).

export function formatTasksGroupedByProject(tasks: TaskRecord[]): string;
// Group by projectName trim; empty/missing → "Tanpa project"
// Named groups sorted alphabetically; "Tanpa project" always last
// Within group, preserve input order
// Shape:
// ## Smart Room Monitor
// - task A (Jatuh tempo: ...)
// - task B
// ## Tanpa project
// - task C
```

- [ ] **Step 1:** Write failing tests for the three formatters (+ notion list mapping test)
- [ ] **Step 2:** `npx vitest run test/project-intelligence.test.ts` — FAIL
- [ ] **Step 3:** Implement helpers + types + listProjects fields
- [ ] **Step 4:** PASS including `test/notion-projects.test.ts` subset / full file
- [ ] **Step 5:** Commit `feat: project intelligence formatters and project status fields`

---

### Task 2: Briefing uses code grouping (TDD)

**Files:**
- Modify: `src/gemini.ts` — `generateTaskBriefing`
- Modify: `test/gemini.test.ts`

Replace flat `- [label] task` map with:
```ts
import { formatTasksGroupedByProject } from "./project-intelligence";
const taskData = formatTasksGroupedByProject(tasksForBriefing);
```

Update system prompt line:
- Remove: `"Kelompokkan secara natural per project bila ada."`
- Add: `"Daftar di bawah SUDAH dikelompokkan per project. Pertahankan pengelompokan itu. Jangan pindahkan task antar project. Jangan menambah task."`

- [ ] **Step 1:** Update test that currently expects `Kelompokkan secara natural` — assert grouped headers (`## Smart Room Monitor`, `## Tanpa project`) appear in systemInstruction; assert new follow-grouping instruction; assert old natural-group line absent
- [ ] **Step 2:** FAIL then implement
- [ ] **Step 3:** Commit `feat: deterministic project grouping in task briefing`

---

### Task 3: Gemini tools list + status (TDD)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

When `context.projectsEnabled` and not group, **also** add (alongside existing CRUD tools):
```ts
{
  name: "list_notion_projects",
  description: "Lists LIFE OS Projects (name, area, status, goal, deadline). Use when Aldo asks daftar/list project.",
  parameters: { type: "OBJECT", properties: {}, required: [] }
},
{
  name: "get_project_status",
  description: "Status of one LIFE OS Project plus its open tasks (To Do/Doing). Use for status/progress/task di project X. Do not invent tasks.",
  parameters: {
    type: "OBJECT",
    properties: {
      project: { type: "STRING", description: "Project name or id to match." }
    },
    required: ["project"]
  }
}
```

Prompt nudge (in `PROJECTS_CRUD_RULES` or short `PROJECT_INTELLIGENCE_RULES` when projectsEnabled):
- Use `list_notion_projects` / `get_project_status` for read/status questions; system returns formatted text — do not invent project/task lists.

- [ ] **Step 1:** Tests — tools present when projectsEnabled; absent when false/group
- [ ] **Step 2–4:** Implement + PASS
- [ ] **Step 5:** Commit `feat: Gemini tools for project list and status`

---

### Task 4: Router handlers (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**`list_notion_projects`:**
1. If !projectsEnabled → `"Projects belum dikonfigurasi."`
2. `ensureProjects()` / `listProjects`
3. `replyMessages.push(formatProjectList(projects))`
4. Do **not** continue to a second model turn inventing content — treat like other sync tools that push a final user-visible line (same pattern as clarify messages). If current CRUD tools push success then may call Gemini again: for these read tools, prefer **short-circuit style** — push formatted text as the reply contribution and skip needing model narration. Match existing pattern for `list` style if any; else push formatted string into `replyMessages` and `continue` (like success create messages).

**`get_project_status`:**
1. If !projectsEnabled → soft-disable message
2. `matchProject(String(args.project||""), await ensureProjects())`
3. none → `"Project tidak cocok. Project yang ada: ${names}. Sebut project yang mana."`
4. ambiguous → `"Beberapa project cocok (${names}). Sebut project yang mana."`
5. one → `listActiveTasks(config)` then `openTasks = tasks.filter(t => t.projectId === project.id)` (active list already To Do/Doing)
6. `replyMessages.push(formatProjectStatus(project, openTasks))`

- [ ] **Step 1:** Tests: list formats; status with tasks; none/ambiguous; soft-disable; projects CRUD still works
- [ ] **Step 2–4:** Implement + PASS
- [ ] **Step 5:** Commit `feat: wire project list and status into router`

---

### Task 5: Verify + deploy

- [ ] `npx vitest run` — all PASS
- [ ] `npx wrangler deploy`
- [ ] Manual DM:
  1. `daftar project`
  2. `status project Smart Room Monitor`
  3. `task di project Portfolio ESP32` (or existing)
  4. `briefing` — grouped by project
  5. Regression: create task linked to Smart Room Monitor

---

## Spec coverage
| Spec item | Task |
|-----------|------|
| formatProjectList / Status / groupTasks | 1 |
| ProjectRecord status/deadline + listProjects | 1 |
| Briefing code grouping | 2 |
| Gemini tools + soft-disable expose | 3 |
| Router handlers + match clarify | 4 |
| Open tasks only | 4 filter via listActiveTasks |
| Deploy + DM | 5 |
| Non-goals (Mars, Done count, …) | omitted |
