# Goals Link v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire LIFE OS Goals into Youyou: list/match, CRUD with delete confirm, and optional Projects→Goal relation — completing Goal → Project → Task.

**Architecture:** Mirror Projects Link+CRUD: `listGoals` / `createGoal` / `updateGoal` / `archiveGoal` in Notion; `matchGoal` + `findExactGoal`; `PendingDelete.kind = "goal"`; Gemini tools gated by `goalsEnabled`; router handlers; extend `createProject`/`updateProject`/`listProjects` with optional `goalId` / `goalName`. Soft-disable when `NOTION_GOALS_DATA_SOURCE_ID` missing.

**Tech Stack:** Cloudflare Worker TypeScript, Notion data_source API, Vitest, existing pending-delete KV + Projects CRUD patterns.

**Spec:** `docs/superpowers/specs/2026-09-20-youyou-goals-link-v1-design.md`

## Global Constraints
- Requires `config.notionGoalsDataSourceId`; soft-disable goal tools/handlers when null. Projects Link/CRUD must keep working without Goals.
- Goals title property: **`Goal`**. Area/Status = Notion **select** (write `{ select: { name } }`). Target Date = **date** via `normalizeNotionDue`. Metric/Notes = **rich_text** (`{ rich_text: textItems(...) }`). Progress = **number** when `typeof progress === "number"` or parseable finite number; otherwise skip Progress write and still allow other fields.
- Projects relation property to Goals: **`Goal`** (same name as title on Goals DB — relation lives on Projects pages).
- Delete goal: always pending confirm; archive goal page only; projects remain.
- Duplicate create: exact case-insensitive goal name → no create, ask user.
- Distinguish LIFE OS Goals tools from Memory category `"Goal"` in prompts.
- Do not regress task↔project, Projects CRUD, Brain delete, Memory 2.0.
- Deploy: Worker + `wrangler secret put NOTION_GOALS_DATA_SOURCE_ID` (value from Aldo: `07f9074e-d2cd-4f52-b855-69e4384c03d9`).

## File map
| File | Responsibility |
|------|----------------|
| `src/types.ts` | `GoalRecord`; `ProjectRecord.goalId?` / `goalName?`; `AppConfig.notionGoalsDataSourceId` |
| `src/config.ts` | read `NOTION_GOALS_DATA_SOURCE_ID` → null if empty |
| `src/goal-match.ts` | `matchGoal`, `findExactGoal` (copy semantics from `project-match.ts`) |
| `src/notion.ts` | goals CRUD + list; project create/update/list Goal relation |
| `src/action-safety.ts` | `PendingDelete.kind` += `"goal"` |
| `src/gemini.ts` | goal tools + `goalsEnabled`; project tools gain optional `goal`; prompt rules |
| `src/router.ts` | handlers, confirm `archiveGoal`, soft-disable gates, pass `goalsEnabled` |
| `test/goal-match.test.ts` | match / exact |
| `test/notion-goals.test.ts` | Notion payloads for goals + project goal relation |
| `test/gemini.test.ts` | tools gate |
| `test/router.test.ts` | CRUD, link, delete confirm, soft-disable |

---

### Task 1: Types, config, matchGoal (TDD)

**Files:**
- Modify: `src/types.ts` — add:

```ts
export interface GoalRecord {
  id: string;
  name: string;
  area?: string | null;
  metric?: string | null;
  progress?: string | number | null;
  status?: string | null;
  targetDate?: string | null;
  notes?: string | null;
}

// On ProjectRecord add:
goalId?: string | null;
goalName?: string | null;

// On AppConfig add:
notionGoalsDataSourceId: string | null;
```

- Modify: `src/config.ts` — same null pattern as projects:

```ts
notionGoalsDataSourceId:
  typeof env.NOTION_GOALS_DATA_SOURCE_ID === "string" && env.NOTION_GOALS_DATA_SOURCE_ID.trim() !== ""
    ? env.NOTION_GOALS_DATA_SOURCE_ID.trim()
    : null,
```

- Ensure `Env` in `types.ts` (or wherever Env is declared) includes optional `NOTION_GOALS_DATA_SOURCE_ID?: string`.
- Create: `src/goal-match.ts` — copy structure from `src/project-match.ts` but types `GoalRecord` / return `{ kind: "one"; goal: GoalRecord }` etc. Export `matchGoal`, `findExactGoal`.
- Create: `test/goal-match.test.ts` — port key cases from `test/project-match.test.ts` (exact, contains, ambiguous, empty, uuid id).

**Interfaces:**
```ts
export type GoalMatchResult =
  | { kind: "none" }
  | { kind: "one"; goal: GoalRecord }
  | { kind: "ambiguous"; candidates: GoalRecord[] };

export function matchGoal(query: string, goals: GoalRecord[]): GoalMatchResult;
export function findExactGoal(name: string, goals: GoalRecord[]): GoalRecord | null;
```

- [ ] **Step 1:** Write failing `test/goal-match.test.ts` (import from `../src/goal-match`)
- [ ] **Step 2:** Run `npx vitest run test/goal-match.test.ts` — expect FAIL (module missing)
- [ ] **Step 3:** Implement `goal-match.ts` + types/config/Env
- [ ] **Step 4:** Run tests — PASS; also fix any `loadConfig` / Env typing breaks in existing tests
- [ ] **Step 5:** Commit `feat: goal match helper and Goals config`

---

### Task 2: Notion Goals CRUD + Project Goal relation (TDD)

**Files:**
- Modify: `src/notion.ts`
- Create/Modify: `test/notion-goals.test.ts`

**Constants:**
```ts
const PROJECT_GOAL_PROPERTY = "Goal"; // relation on Projects
const GOALS_PAGE_SIZE = 100;
const GOALS_MAX_ITEMS = 300;
```

**Interfaces:**
```ts
export async function listGoals(
  config: AppConfig,
  fetchImpl?: typeof fetch,
): Promise<GoalRecord[]>;
// Empty array if !notionGoalsDataSourceId
// Map: title Goal; Area.select.name; Status.select.name;
// Metric: rich_text plain or number→string; Progress: number or rich_text;
// Target Date: date.start; Notes: rich_text plain

export async function createGoal(
  config: AppConfig,
  goal: {
    name: string;
    area?: string;
    metric?: string;
    progress?: string | number;
    status?: string;
    target_date?: string;
    notes?: string;
  },
  fetchImpl?: typeof fetch,
): Promise<string>;
// Throws NotionRejectionError if !notionGoalsDataSourceId

export async function updateGoal(
  config: AppConfig,
  pageId: string,
  update: {
    name?: string;
    area?: string;
    metric?: string;
    progress?: string | number;
    status?: string;
    target_date?: string;
    notes?: string;
  },
  fetchImpl?: typeof fetch,
): Promise<void>;

export async function archiveGoal(
  config: AppConfig,
  pageId: string,
  fetchImpl?: typeof fetch,
): Promise<void>;
// DELETE /blocks/{id} (same as archiveProject)
```

**Extend project APIs:**
```ts
// createProject third fields:
project: { name: string; area?: string; deadline?: string; goalId?: string }

// updateProject:
update: { name?: string; area?: string; deadline?: string; goalId?: string | null }
// goalId string → set relation [{ id }]; goalId null → clear relation []

// listProjects: when goals configured, resolve Goal relation → goalId + goalName
// Soft-fail: if goals list fails, still return projects without goalName (log error)
```

Helper to build Goal relation property:
```ts
if (project.goalId) {
  properties[PROJECT_GOAL_PROPERTY] = { relation: [{ id: project.goalId }] };
}
```

- [ ] **Step 1:** Tests for createGoal body (title Goal, Area select, Progress number, Target Date); updateGoal PATCH; archiveGoal DELETE; createProject includes Goal relation when goalId set; listProjects maps goalName when relation present
- [ ] **Step 2:** Run `npx vitest run test/notion-goals.test.ts` — FAIL
- [ ] **Step 3:** Implement Notion helpers + extend create/update/list projects
- [ ] **Step 4:** PASS
- [ ] **Step 5:** Commit `feat: Notion Goals CRUD and Project Goal relation`

---

### Task 3: PendingDelete kind `goal` (TDD)

**Files:**
- Modify: `src/action-safety.ts` — `kind: "tasks" | "notes" | "memory" | "project" | "goal"`
- Modify: `src/router.ts` — `deleteKindLabel`: goal → `"goal"`; confirm branch:

```ts
if (pending.kind === "goal" && !config.notionGoalsDataSourceId) {
  await deps.clearPendingDelete(env, userId);
  return "Goals belum dikonfigurasi.";
}
// in loop:
if (pending.kind === "goal") await deps.archiveGoal(config, id);
else if (pending.kind === "project") await deps.archiveProject(config, id);
else await deps.archiveTask(config, id);
```

Wire `archiveGoal`, `listGoals`, `createGoal`, `updateGoal` on `RouterDeps` + `defaultDeps`.

- [ ] **Step 1:** Router test: pending kind goal + “ya” calls `archiveGoal`; label “goal”; soft-disable when no goals id
- [ ] **Step 2:** FAIL then implement
- [ ] **Step 3:** Commit `feat: pending-delete support for goals`

---

### Task 4: Gemini tools + goalsEnabled (TDD)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Context flags:** `goalsEnabled?: boolean` (in addition to existing `projectsEnabled`).

When `goalsEnabled` and not group, add tools:
- `create_notion_goal` — `{ name, area?, metric?, progress?, status?, target_date?, notes? }`
- `update_notion_goal` — `{ goal, new_name?, area?, metric?, progress?, status?, target_date?, notes? }`
- `delete_notion_goal` — `{ goal }`

When `projectsEnabled`, extend project tool schemas with optional `goal` (string name/id).

**Prompt rules (replace “do not invent Goals” for LIFE OS):**
- LIFE OS Goals tools for measurable targets (Area/Metric/Progress); Memory category `Goal` remains for long-lived facts about Aldo — different stores.
- Use goal CRUD only when goalsEnabled; do not invent goal names not in list.
- create/update project may pass `goal` when user links a project to a goal.
- delete_notion_goal always via tool; system asks ya/jangan.

Pass known goals into prompt when listed (format like projects), e.g. `formatGoalsForPrompt(goals: GoalRecord[])`.

Router will pass `goals?: GoalRecord[]` and `goalsEnabled` into `generateChatReply`.

- [ ] **Step 1:** Tests — tools present when goalsEnabled; absent when false/group; project tool schema includes `goal` when projectsEnabled
- [ ] **Step 2–4:** Implement + PASS
- [ ] **Step 5:** Commit `feat: Gemini tools for Goals Link`

---

### Task 5: Router wiring (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Load goals (DM only, soft-fail like projects):**
```ts
const goalsEnabled = Boolean(config.notionGoalsDataSourceId);
// parallel fetch listGoals when goalsEnabled; catch → []
const ensureGoals = async (): Promise<GoalRecord[]> => { /* refresh if empty */ };
```

Pass into Gemini: `goalsEnabled`, `goals`, keep `projectsEnabled` / `projects`.

**create_notion_goal:**
1. If !goalsEnabled → “Goals belum dikonfigurasi.”
2. `findExactGoal(name)` → “Goal 'X' sudah ada. Pakai itu atau pilih nama lain.”
3. Else `createGoal`; success reply.

**update_notion_goal:**
1. `matchGoal`; none/ambiguous → clarify with names
2. `updateGoal(id, fields)`
3. Success

**delete_notion_goal:**
1. match; clarify if needed
2. `savePendingDelete({ kind: "goal", ids: [id], summary: name, createdAt: Date.now() })`
3. Reply: `Aldo, yakin hapus goal X? Project di bawahnya tidak ikut terhapus. Balas "ya" atau "jangan".`

**create_notion_project / update_notion_project (extend):**
- If `args.goal` string non-empty:
  - If !goalsEnabled → “Goals belum dikonfigurasi.” (and do not create/update project if user required a goal link — prefer: block write and ask)
  - `matchGoal`; none/ambiguous → clarify; do not create/update yet
  - on one → pass `goalId` into createProject / updateProject
- If no goal arg → existing behavior (no goal relation)

- [ ] **Step 1:** Tests: create goal; dup; update; delete pending + ya→archiveGoal; create project with goal sets goalId; soft-disable goals; projects CRUD still works without goals
- [ ] **Step 2–4:** Implement + PASS
- [ ] **Step 5:** Commit `feat: wire Goals Link into router`

---

### Task 6: Verify + secret + deploy

- [ ] `npx vitest run` — all PASS
- [ ] `npx wrangler secret put NOTION_GOALS_DATA_SOURCE_ID`  
  Paste: `07f9074e-d2cd-4f52-b855-69e4384c03d9`
- [ ] `npx wrangler deploy`
- [ ] Manual DM:
  1. `buat goal Dapat income pertama dari skill area Income metric Rp100000`
  2. `ubah progress goal Menguasai Embedded + IoT jadi 5`
  3. `buat project Portfolio ESP32 untuk goal Menguasai Embedded + IoT`
  4. `hapus goal Dapat income pertama dari skill` → `ya` → Smart Room Monitor tetap ada
  5. Regression: `buat task cek sensor untuk Smart Room Monitor` still links project

---

## Spec coverage
| Spec item | Task |
|-----------|------|
| GoalRecord + config secret | 1 |
| matchGoal / findExactGoal | 1 |
| list/create/update/archive Goal | 2 |
| Project Goal relation read/write | 2 + 5 |
| PendingDelete kind goal | 3 |
| Gemini tools + Memory vs LIFE OS | 4 |
| Router CRUD + project goal arg | 5 |
| Soft-disable | 3–5 |
| No cascade projects | 3 + 5 copy |
| Dup exact name | 5 |
| Deploy + secret + DM | 6 |
| Non-goals (auto progress, Learning…) | omitted by design |
