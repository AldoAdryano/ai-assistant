# Projects Link v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Link Youyou Tasks to LIFE OS Projects via Notion Relation — match/assign on create, show project on list/briefing, soft-disable when Projects data source id is missing.

**Architecture:** Pure `matchProject` helper; optional `notionProjectsDataSourceId` on config; `listProjects` + relation on `createTask` / resolve names on `listActiveTasks`; Gemini gets known projects + optional `project` arg; router resolves match before write; briefing lines include `[ProjectName]`.

**Tech Stack:** Cloudflare Worker TypeScript, Notion API `data_source` query, Vitest, existing Gemini tools + Task Intelligence briefing.

**Spec:** `docs/superpowers/specs/2026-09-19-youyou-projects-link-v1-design.md`

## Global Constraints
- Relation property name on Tasks: **`Project`** (Notion UI must match).
- Projects DB title property: **`Project`** (LIFE OS).
- Env/secret: optional `NOTION_PROJECTS_DATA_SOURCE_ID` — empty → soft-disable (no crash; ignore project args; log once).
- Infer project from context when clear; ambiguous/0 match → clarify (do not silently pick); allow no project.
- Do not create/edit Projects pages from chat (v1).
- Do not regress Brain / Memory / Context / Task Intelligence.
- Deploy: Worker + secret; Notion relation setup is manual (Task 0 / human).
- DM Notion tools only (existing group rules unchanged).

## File map
| File | Responsibility |
|------|----------------|
| `src/project-match.ts` | `matchProject`, types for match result |
| `src/types.ts` | `ProjectRecord`, extend `TaskRecord` + `Env`/`AppConfig` |
| `src/config.ts` | optional `notionProjectsDataSourceId` |
| `src/notion.ts` | `listProjects`, create/list with relation |
| `src/gemini.ts` | inject projects; `project` on create tool; briefing labels |
| `src/router.ts` | resolve match on create; list lines with project |
| `test/project-match.test.ts` | match cases |
| `test/notion.test.ts` (or new) | list/create relation payloads |
| `test/router.test.ts` / `gemini.test.ts` | wiring |

---

### Task 0: Notion setup (human — before or during deploy)

**Not code.** Controller/user must:

1. Tasks DB → add Relation property named exactly `Project` → LIFE OS **Projects**.
2. Share Projects (+ Tasks) with the Youyou Notion integration.
3. Copy Projects **data source id** for `wrangler secret put NOTION_PROJECTS_DATA_SOURCE_ID`.

- [ ] Confirm relation exists named `Project`
- [ ] Note data source id ready for Task 6

---

### Task 1: Types, config, `matchProject` (TDD)

**Files:**
- Create: `src/project-match.ts`
- Create: `test/project-match.test.ts`
- Modify: `src/types.ts`
- Modify: `src/config.ts`

**Interfaces:**
```ts
// types.ts
export interface ProjectRecord {
  id: string;
  name: string;
  area?: string | null;
}

export interface TaskRecord {
  id: string;
  task: string;
  status: "To Do" | "Doing" | "Done";
  priority: Priority;
  due?: string;
  projectId?: string | null;
  projectName?: string | null;
}

// Env + AppConfig
notionProjectsDataSourceId?: string; // AppConfig: string | null
```

```ts
// project-match.ts
import type { ProjectRecord } from "./types";

export type ProjectMatchResult =
  | { kind: "none" }
  | { kind: "one"; project: ProjectRecord }
  | { kind: "ambiguous"; candidates: ProjectRecord[] };

/** Exact (ci) → then unique substring contains; 0→none, 1→one, 2+→ambiguous. Empty query → none. */
export function matchProject(query: string, projects: ProjectRecord[]): ProjectMatchResult;
```

**Config:** Like routine — if `env.NOTION_PROJECTS_DATA_SOURCE_ID` is non-empty string, set `notionProjectsDataSourceId`; else `null`.

- [ ] **Step 1: Failing tests** `test/project-match.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { matchProject } from "../src/project-match";
import type { ProjectRecord } from "../src/types";

const projects: ProjectRecord[] = [
  { id: "1", name: "Persiapan IKN" },
  { id: "2", name: "Portfolio Embedded" },
  { id: "3", name: "KRTI VTOL" },
];

describe("matchProject", () => {
  it("exact case-insensitive", () => {
    expect(matchProject("persiapan ikn", projects)).toEqual({
      kind: "one",
      project: projects[0],
    });
  });
  it("unique contains", () => {
    expect(matchProject("IKN", projects).kind).toBe("one");
  });
  it("ambiguous contains", () => {
    const r = matchProject("a", [
      { id: "1", name: "Alpha" },
      { id: "2", name: "Beta" },
      { id: "3", name: "Gamma" },
    ]);
    // use query that hits 2 names:
    expect(matchProject("port", [
      { id: "1", name: "Portfolio A" },
      { id: "2", name: "Portfolio B" },
    ]).kind).toBe("ambiguous");
  });
  it("none", () => {
    expect(matchProject("Finance", projects)).toEqual({ kind: "none" });
  });
  it("empty query → none", () => {
    expect(matchProject("  ", projects)).toEqual({ kind: "none" });
  });
});
```

- [ ] **Step 2:** `npx vitest run test/project-match.test.ts` → FAIL
- [ ] **Step 3: Implement** `matchProject` + types + config optional id
- [ ] **Step 4:** tests PASS
- [ ] **Step 5: Commit** `feat: project match helper and optional Projects config`

---

### Task 2: Notion listProjects + create/list relation (TDD)

**Files:**
- Modify: `src/notion.ts`
- Modify: `test/notion.test.ts` (extend) or create `test/notion-projects.test.ts`

**Interfaces:**
```ts
export const TASK_PROJECT_PROPERTY = "Project";

export async function listProjects(
  config: AppConfig,
  fetchImpl?: typeof fetch,
): Promise<ProjectRecord[]>;
// If !config.notionProjectsDataSourceId → return [] (no fetch).

// createTask extends payload:
task: {
  task: string;
  priority: Priority;
  due_date?: string;
  due_time?: string;
  notes?: string;
  projectId?: string; // when set and projects enabled, set relation
}

// listActiveTasks / getAllTasks map:
// relation ids from page.properties.Project.relation → projectId
// resolve names via one listProjects call (or id→name map passed) inside listActiveTasks when projects configured
```

**listProjects query:**
```ts
await notionRequest(config, `/data_sources/${config.notionProjectsDataSourceId}/query`, {
  method: "POST",
  body: JSON.stringify({ page_size: 50 }),
}, fetchImpl);
// Map: id, name = titleText(properties.Project)
// Optional area = select name if properties.Area?.select?.name
```

**createTask relation write** (only if `task.projectId` and `config.notionProjectsDataSourceId`):
```ts
properties[TASK_PROJECT_PROPERTY] = { relation: [{ id: task.projectId }] };
```

**listActiveTasks:** After query pages, if projects enabled:
```ts
const projects = await listProjects(config, fetchImpl);
const byId = new Map(projects.map(p => [p.id, p.name]));
// for each page:
const rel = page.properties?.[TASK_PROJECT_PROPERTY]?.relation;
const projectId = Array.isArray(rel) && rel[0]?.id ? rel[0].id : null;
const projectName = projectId ? (byId.get(projectId) ?? null) : null;
```

Same mapping helper for `getAllTasks`.

- [ ] Tests: createTask body includes relation when projectId set; omits when not; listProjects returns []; listActiveTasks fills projectName from mocked relation + projects query
- [ ] Commit: `feat: Notion Projects list and Task relation`

---

### Task 3: Gemini prompt + tool arg + briefing labels (TDD)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Interfaces:**
- Extend `generateChatReply` context: `projects?: ProjectRecord[]`
- DM system prompt when `projects?.length`: block  
  `Known LIFE OS projects (use these names only; do not invent):\n- Name (id: …)`  
  Rules: optional `project` on create = best matching name; if unsure which project → clarify text, do **not** call create yet; omit `project` if none.
- `create_notion_task` parameters add optional:  
  `project: { type: "STRING", description: "Exact or clear LIFE OS project name from Known projects list. Omit if none / user said without project." }`
- `generateTaskBriefing` task lines:  
  `- [ProjectName] Task title (Jatuh tempo: …)` or `- [Tanpa project] …` when no name  
  Add rule: “Kelompokkan secara natural per project bila ada.”

- [ ] Test: systemInstruction contains “Known LIFE OS projects” when projects passed; create tool schema includes `project`; briefing prompt contains `[Persiapan IKN]` when task has projectName
- [ ] Commit: `feat: Gemini project awareness for tasks and briefing`

---

### Task 4: Router wiring (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Behavior:**
1. When loading DM context for Gemini, if `config.notionProjectsDataSourceId`: `listProjects` in parallel with tasks/memories; pass `projects` into `generateChatReply`.
2. On `create_notion_task`:
   - If no projects config → create as today (ignore `args.project`).
   - If `args.project` string:
     - `matchProject(args.project, projects)` (load projects if not already)
     - `one` → pass `projectId` to `createTask`
     - `none` → push clarify: list up to 5 project names + “sebut project yang mana, atau bilang tanpa project”; **do not** create
     - `ambiguous` → push clarify with candidate names; **do not** create
   - If no `args.project` → create without relation (OK).
3. `read_notion_tasks` lines:  
   `${i}. [${priority}] ${task}${projectName ? ` ⟨${projectName}⟩` : ""}${due ? ` — ${due}` : ""}`

Wire `listProjects` into `RouterDeps` / `defaultDeps`.

**Tests:**
1. create with project match → `createTask` called with `projectId`
2. create with unknown project → no `createTask`; message asks clarify
3. ambiguous → no create
4. projects disabled (null id) → create without projectId even if args.project set
5. read_notion_tasks includes ⟨Project⟩ when present

- [ ] Commit: `feat: wire Projects Link into router`

---

### Task 5: Verify + deploy checklist

- [ ] `npx vitest run` — all PASS
- [ ] Human: Notion relation `Project` + integration access (Task 0)
- [ ] `npx wrangler secret put NOTION_PROJECTS_DATA_SOURCE_ID`
- [ ] `npx wrangler deploy`
- [ ] Manual DM: create task mentioning a real project name; confirm relation in Notion; `briefing` shows project label; task without project still works

---

## Spec coverage
| Spec item | Task |
|-----------|------|
| Relation property `Project` | Task 0 + 2 |
| Soft-disable without secret | Task 1–4 |
| matchProject none/one/ambiguous | Task 1 + 4 |
| create with relation | Task 2 + 4 |
| list + projectName | Task 2 + 4 |
| Gemini infer/clarify rules | Task 3 |
| Briefing group/label | Task 3 |
| No Projects CRUD from chat | (no task adds it) |
| Deploy | Task 5 |
