# Learning Link v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire LIFE OS Learning into Youyou: match, list, CRUD with delete confirm, and Brain rules that clarify Task vs Learning when ambiguous.

**Architecture:** Mirror Goals Link: `listLearning` / `createLearning` / `updateLearning` / `archiveLearning`; `matchLearning` + `findExactLearning`; `PendingDelete.kind = "learning"`; Gemini tools gated by `learningEnabled`; router handlers + deterministic list formatter; prompt rules for Task vs Learning boundary.

**Tech Stack:** Cloudflare Worker TypeScript, Notion data_source API, Vitest, existing Goals/Projects patterns.

**Spec:** `docs/superpowers/specs/2026-09-20-youyou-learning-link-v1-design.md`

## Global Constraints
- Requires `config.notionLearningDataSourceId`; soft-disable Learning tools/handlers when null.
- Title property: **`Skill`**. Area/Status = **select** when writing. Last Practiced = **date** via `normalizeNotionDue`. Target = **rich_text**. Resource = **url** if looks like URL else **rich_text**. Level = **number** when finite number else skip Level write.
- Delete: always pending confirm; archive Learning page only.
- Duplicate create: exact-ci skill name → no create, ask user.
- Brain: explicit schedule → Task; explicit skill/stack → Learning; **ambiguous → clarify** (never silent dual-write).
- Do not regress Goals, Projects, PI, briefing short-circuit, bridge-hint strip.
- Deploy: Worker + `wrangler secret put NOTION_LEARNING_DATA_SOURCE_ID` (Aldo provides id at Task 6).

## File map
| File | Responsibility |
|------|----------------|
| `src/types.ts` / `config.ts` | `LearningRecord`, `notionLearningDataSourceId`, Env |
| `src/learning-match.ts` | `matchLearning`, `findExactLearning` |
| `src/notion.ts` | Learning CRUD + list |
| `src/action-safety.ts` | `PendingDelete.kind` += `"learning"` |
| `src/learning-format.ts` | `formatLearningList` |
| `src/gemini.ts` | tools + LEARNING rules + Task/Learning boundary |
| `src/router.ts` | handlers + confirm `archiveLearning` |
| `test/learning-match.test.ts` | match |
| `test/notion-learning.test.ts` | payloads |
| `test/gemini.test.ts` | tools gate + prompt boundary |
| `test/router.test.ts` | CRUD, list, delete confirm, soft-disable |

---

### Task 1: Types, config, matchLearning (TDD)

**Files:**
- Modify: `src/types.ts`:

```ts
export interface LearningRecord {
  id: string;
  name: string;
  area?: string | null;
  level?: string | number | null;
  status?: string | null;
  target?: string | null;
  resource?: string | null;
  lastPracticed?: string | null;
}
// AppConfig + Env:
notionLearningDataSourceId: string | null;
NOTION_LEARNING_DATA_SOURCE_ID?: string;
```

- Modify: `src/config.ts` — null-if-empty trim (same as Goals).
- Create: `src/learning-match.ts` — port from `goal-match.ts`.
- Create: `test/learning-match.test.ts` — exact, contains, ambiguous, empty, id/UUID, findExactLearning.

```ts
export type LearningMatchResult =
  | { kind: "none" }
  | { kind: "one"; skill: LearningRecord }
  | { kind: "ambiguous"; candidates: LearningRecord[] };

export function matchLearning(query: string, skills: LearningRecord[]): LearningMatchResult;
export function findExactLearning(name: string, skills: LearningRecord[]): LearningRecord | null;
```

- [ ] Failing tests → implement → PASS → commit `feat: learning match helper and Learning config`

---

### Task 2: Notion Learning CRUD (TDD)

**Files:** `src/notion.ts`, `test/notion-learning.test.ts`

```ts
export async function listLearning(config: AppConfig, fetchImpl?: typeof fetch): Promise<LearningRecord[]>;
export async function createLearning(config: AppConfig, skill: {
  name: string; area?: string; level?: string | number; status?: string;
  target?: string; resource?: string; last_practiced?: string;
}, fetchImpl?: typeof fetch): Promise<string>;
export async function updateLearning(config: AppConfig, pageId: string, update: {
  name?: string; area?: string; level?: string | number; status?: string;
  target?: string; resource?: string; last_practiced?: string;
}, fetchImpl?: typeof fetch): Promise<void>;
export async function archiveLearning(config: AppConfig, pageId: string, fetchImpl?: typeof fetch): Promise<void>;
```

Property builders: Skill title; Area/Status select; Level number if finite; Target rich_text; Resource url or rich_text; Last Practiced date. Soft-disable: list → `[]`; create throws `NotionRejectionError`.

- [ ] Tests → implement → commit `feat: Notion Learning CRUD`

---

### Task 3: PendingDelete kind `learning` (TDD)

**Files:** `src/action-safety.ts`, `src/router.ts`

- `kind` += `"learning"`
- `deleteKindLabel` → `"skill"`
- Confirm → `archiveLearning`; gate → `"Learning belum dikonfigurasi."`
- Wire deps: listLearning, createLearning, updateLearning, archiveLearning

- [ ] Tests → commit `feat: pending-delete support for learning skills`

---

### Task 4: Gemini tools + Brain boundary (TDD)

**Files:** `src/gemini.ts`, `test/gemini.test.ts`

When `learningEnabled` and not group:
- `create_notion_learning`, `update_notion_learning`, `delete_notion_learning`, `list_notion_learning` (optional `status`)

`LEARNING_RULES`:
1. LIFE OS Learning = skill stack — not Memory, not Goals.
2. Explicit schedule/deadline for a study session → `create_notion_task`.
3. Explicit skill/stack → Learning tools.
4. Ambiguous “belajar X” without schedule → **clarify** (Task vs Learning); do not create either silently.
5. delete always via tool; system asks ya/jangan.

- [ ] Tests → commit `feat: Gemini tools for Learning Link`

---

### Task 5: Router wiring (TDD)

**Files:** `src/router.ts`, `test/router.test.ts`, optionally `src/learning-format.ts`

- Soft-fail listLearning; pass `learningEnabled` + `learning` into Gemini
- **list:** formatLearningList; short-circuit like list_notion_projects
- **create:** dup exact → clarify; else create
- **update / delete:** matchLearning; delete → pending kind learning; copy: `Aldo, yakin hapus skill X? Balas "ya" atau "jangan".`
- Add `delete_notion_learning` to `DELETE_TOOL_NAMES`

`formatLearningList`: empty → “Belum ada skill di Learning.”; else `• name — Area; Level; Status` (omit missing).

- [ ] Tests → commit `feat: wire Learning Link into router`

---

### Task 6: Verify + secret + deploy

- [ ] `npx vitest run` PASS
- [ ] Aldo provides Learning data source id → `wrangler secret put NOTION_LEARNING_DATA_SOURCE_ID`
- [ ] `npx wrangler deploy`
- [ ] Manual DM from spec checklist

---

## Spec coverage
| Item | Task |
|------|------|
| LearningRecord + config | 1 |
| matchLearning | 1 |
| Notion CRUD | 2 |
| Pending delete | 3 |
| Gemini + Task/Learning clarify | 4 |
| Router + list + DELETE gate | 5 |
| Deploy | 6 |
| Non-goals (Finance…) | omitted |
