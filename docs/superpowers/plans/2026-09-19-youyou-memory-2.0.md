# Memory 2.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Structured Memory categories (Identity / Preference / Goal / Project / Pattern / Other) with hybrid write: explicit remember → upsert immediately; inferred → pending confirm (`ya` / `jangan`).

**Architecture:** Expand `MemoryCategory` and Gemini tool/prompt; pure helpers `userExplicitRemember` + gate; KV `pending_memory` mirroring delete-confirm; router enforces gate and confirm short-circuit (delete confirm wins if both pending).

**Tech Stack:** Cloudflare Worker TypeScript, Vitest, Notion Memory data source, `DEDUP_KV`.

**Spec:** `docs/superpowers/specs/2026-09-19-youyou-memory-2.0-design.md`

## Global Constraints
- Single Memory DB only — no new Goals/Projects databases.
- Hybrid C: code cannot be bypassed for inferred / Pattern writes.
- Pattern always confirm (unless user explicitly asked to save that pattern).
- Pending delete confirm takes priority over pending memory confirm.
- Reuse Brain v1 confirm phrase helpers + 10-minute freshness.
- Deploy: Worker only (`wrangler deploy`).
- Youyou-tone Indonesian propose strings.
- Do not regress Brain v1 task Notes / invented-due / multi-create / delete confirm.

---

### Task 1: Types + explicit-remember helpers (TDD)

**Files:**
- Modify: `src/types.ts`
- Modify: `src/action-safety.ts`
- Create/Modify: `test/action-safety.test.ts`

**Interfaces:**
- Produces:
  - `MemoryCategory = "Identity" | "Preference" | "Goal" | "Project" | "Pattern" | "Other" | "Profile"`
  - `export type PendingMemory = { key: string; value: string; category: Exclude<MemoryCategory, "Profile">; createdAt: number }`
  - `export function userExplicitRemember(userText: string): boolean` — true for ingat bahwa / ingat ya / simpan (preferensi|memori) / catat di memori / remember that (ID/EN light)
  - `export function shouldConfirmMemoryWrite(input: { userText: string; category: string }): boolean` — true if Pattern OR !userExplicitRemember(userText)
  - `export function formatMemoryPropose(pending: PendingMemory): string` — Indonesian propose ask ya/jangan
  - Reuse `isPositiveDeleteConfirm` / `isNegativeDeleteConfirm` / `PENDING_DELETE_FRESH_MS` (alias freshness for memory as same constant or `isPendingMemoryFresh`)

- [ ] **Step 1: Expand MemoryCategory in types.ts**

```ts
export type MemoryCategory =
  | "Identity"
  | "Preference"
  | "Goal"
  | "Project"
  | "Pattern"
  | "Other"
  | "Profile"; // legacy read
```

- [ ] **Step 2: Write failing tests** for `userExplicitRemember`, `shouldConfirmMemoryWrite`, `formatMemoryPropose`

```ts
it("explicit remember phrases", () => {
  expect(userExplicitRemember("Ingat bahwa kuliah saya di UNY")).toBe(true);
  expect(userExplicitRemember("aku kuliah di UNY")).toBe(false);
});
it("Pattern always confirms", () => {
  expect(shouldConfirmMemoryWrite({ userText: "ingat bahwa saya sering menunda", category: "Pattern" })).toBe(true);
});
it("explicit non-Pattern skips confirm", () => {
  expect(shouldConfirmMemoryWrite({ userText: "ingat bahwa kuliah UNY", category: "Identity" })).toBe(false);
});
```

- [ ] **Step 3: Implement helpers until green**

- [ ] **Step 4: Commit** `feat: Memory 2.0 categories and remember helpers`

---

### Task 2: Pending-memory KV state (TDD)

**Files:**
- Modify: `src/state.ts`
- Create: `test/pending-memory-state.test.ts`

**Interfaces:**
- Produces: `savePendingMemory`, `getPendingMemory`, `clearPendingMemory`
- `clearMemory` also deletes `pending_memory:${userId}`
- Import `PendingMemory` from `action-safety` (or types — prefer action-safety next to PendingDelete)

- [ ] **Step 1: Failing tests** (Map-like KV mock, same style as pending-delete-state)

- [ ] **Step 2: Implement**

- [ ] **Step 3: PASS + Commit** `feat: KV pending memory for Memory 2.0`

---

### Task 3: Router gate + confirm (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Interfaces:**
- Extend `RouterDeps` with pending memory get/save/clear
- After pending-delete block (delete wins), handle pending-memory ya/jangan (DM only, fresh)
- On `create_notion_memory`:
  - Normalize category: if `Profile` → write as `Identity`
  - If `shouldConfirmMemoryWrite({ userText: payload.text, category })` → savePendingMemory, push `formatMemoryPropose`, **do not** upsertMemory
  - Else → upsertMemory as today
- Multiple create_notion_memory in one turn: process first confirm-needed as pending; skip extras with short message (same spirit as delete batch)

**Tests:**
1. Explicit "Ingat bahwa …" + create_notion_memory Identity → upsertMemory called once, no pending
2. Inferred (no explicit phrase) + create → no upsert; savePendingMemory; reply matches /ingat|ya|jangan/i
3. Pending + "ya" → upsertMemory with pending fields; skip Gemini
4. Pending + "jangan" → no upsert; clear
5. Pattern + explicit ingat → still confirm (shouldConfirm true)
6. Pending delete present → delete path runs; memory pending ignored that turn

- [ ] **Step 1: Failing router tests**
- [ ] **Step 2: Implement**
- [ ] **Step 3: `npx vitest run test/router.test.ts test/action-safety.test.ts` PASS**
- [ ] **Step 4: Commit** `feat: enforce memory propose-confirm in router`

---

### Task 4: Gemini Memory 2.0 prompt + grouped context

**Files:**
- Modify: `src/gemini.ts`
- Optional: `src/notion.ts` — map Profile→display as Identity in mapMemory category field for prompt grouping only if cleaner (or group Profile under Identity in formatter)

**Interfaces:**
- Add `MEMORY_V2_RULES` (or extend BRAIN) for DM
- Tool `create_notion_memory` enum: Identity, Preference, Goal, Project, Pattern, Other (drop Profile from write enum)
- `formatMemoriesForPrompt(memories: MemoryRecord[]): string` — group by category order Identity, Preference, Goal, Project, Pattern, Other, Profile; cap ~12 lines total

- [ ] **Step 1: Implement formatter + wire into systemPrompt / inputText**
- [ ] **Step 2: Full `npx vitest run` PASS**
- [ ] **Step 3: Commit** `feat: Memory 2.0 Gemini rules and grouped context`

---

### Task 5: Verify + deploy note

- [ ] `npx vitest run` + typecheck (ignore pre-existing `process` TS2591 only)
- [ ] `npx wrangler deploy` when executing with user
- [ ] Manual Notion: ensure Category options include Identity, Goal, Pattern
- [ ] Manual DM checklist from spec success criteria 1–4

---

## Self-review
- Spec success 1–5 covered by Tasks 3–4 + manual
- PendingMemory type consistent across tasks
- No TBD placeholders
- Delete-confirm priority documented in Task 3
