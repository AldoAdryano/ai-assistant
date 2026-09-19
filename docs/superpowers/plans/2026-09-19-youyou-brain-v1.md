# Youyou Brain v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop over-create (Simurelay → N tasks) and unsafe mass-delete by adding hybrid Intent rules in Gemini plus hard Action Safety guards in the Worker router.

**Architecture:** Pure helpers in `src/action-safety.ts` decide multi-create allow/block and delete confirm/execute. `src/state.ts` stores pending delete in KV. `src/router.ts` enforces guards before Notion writes. `src/gemini.ts` adds Brain prompt rules for intent + no over-create. Bridge unchanged.

**Tech Stack:** Cloudflare Worker (TypeScript), Vitest, existing Gemini function-calling + Notion tools, `DEDUP_KV`.

**Spec:** `docs/superpowers/specs/2026-09-19-youyou-brain-v1-design.md`

## Global Constraints
- Policy B: clear single task → create immediately; ambiguous/multi → clarify; mass delete → always confirm in code.
- Hybrid C: prompt for intent; code cannot be bypassed for multi-create and delete.
- No new Notion DBs; no bridge/Termux changes; no `classify_intent` tool.
- Deploy: Worker only (`wrangler deploy`).
- Keep Youyou tone in user-facing clarify/confirm strings (Indonesian, concise).
- Existing delete test that archives without confirm must be updated to the new confirm flow.

---

### Task 1: Action-safety pure helpers (TDD)

**Files:**
- Create: `src/action-safety.ts`
- Create: `test/action-safety.test.ts`

**Interfaces:**
- Produces:
  - `export type PendingDelete = { kind: "tasks" | "notes" | "memory"; ids: string[]; summary: string; createdAt: number }`
  - `export function userExplicitMultiCreate(userText: string): boolean` — true only when user clearly asks for multiple separate tasks (e.g. `buat 3 tugas`, `buat dua tugas:`, numbered/bullet list of distinct tasks).
  - `export function filterCreateTaskCalls(calls: Array<{ name: string; args: Record<string, unknown> }>, userText: string): { allowed: typeof calls; blocked: boolean; clarifyMessage?: string }`
    - If `create_notion_task` count ≤ 1 → all allowed, `blocked: false`.
    - If count > 1 and `!userExplicitMultiCreate(userText)` → allow **zero** creates (or optionally first only — **prefer zero + clarify** to match “satu atau beberapa?”), set `blocked: true`, `clarifyMessage` Indonesian ask one-vs-many.
    - If count > 1 and explicit multi → allow all.
  - `export function isPositiveDeleteConfirm(userText: string): boolean` — matches ya/yakin/hapus/boleh/ok/oke/lanjutkan (case-insensitive, whole-ish message, Indonesian).
  - `export function isNegativeDeleteConfirm(userText: string): boolean` — tidak/jangan/batal/cancel.

- [ ] **Step 1: Write failing tests** in `test/action-safety.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  filterCreateTaskCalls,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
  userExplicitMultiCreate,
} from "../src/action-safety";

describe("userExplicitMultiCreate", () => {
  it("false for single-topic burst text", () => {
    expect(userExplicitMultiCreate("Simurelay error lagi\ncek board\nfix wiring")).toBe(false);
  });
  it("true for explicit count", () => {
    expect(userExplicitMultiCreate("buat 3 tugas: A, B, dan C")).toBe(true);
  });
});

describe("filterCreateTaskCalls", () => {
  const four = [1, 2, 3, 4].map((i) => ({
    name: "create_notion_task",
    args: { title: `Tugas ${i}` },
  }));

  it("blocks multi-create without explicit signal", () => {
    const r = filterCreateTaskCalls(four, "soal Simurelay ini itu");
    expect(r.allowed).toHaveLength(0);
    expect(r.blocked).toBe(true);
    expect(r.clarifyMessage).toMatch(/satu|beberapa/i);
  });

  it("allows single create", () => {
    const r = filterCreateTaskCalls([four[0]], "buat tugas laprak deadline besok");
    expect(r.allowed).toHaveLength(1);
    expect(r.blocked).toBe(false);
  });

  it("allows multi when explicit", () => {
    const r = filterCreateTaskCalls(four.slice(0, 3), "buat 3 tugas: A, B, C");
    expect(r.allowed).toHaveLength(3);
    expect(r.blocked).toBe(false);
  });
});

describe("delete confirm phrases", () => {
  it("detects positive and negative", () => {
    expect(isPositiveDeleteConfirm("ya hapus")).toBe(true);
    expect(isNegativeDeleteConfirm("jangan")).toBe(true);
    expect(isPositiveDeleteConfirm("besok saja")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npx vitest run test/action-safety.test.ts`
Expected: FAIL (module missing)

- [ ] **Step 3: Implement `src/action-safety.ts`** until green (keep heuristics simple; prefer false negatives on `userExplicitMultiCreate` so we clarify more often than over-create).

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run test/action-safety.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/action-safety.ts test/action-safety.test.ts
git commit -m "feat: add action-safety helpers for Brain v1"
```

---

### Task 2: Pending-delete KV state (TDD)

**Files:**
- Modify: `src/state.ts`
- Create: `test/pending-delete-state.test.ts` (or extend an existing state test if present)
- Modify: `src/router.ts` `RouterDeps` only after tests pass — wire in Task 3

**Interfaces:**
- Produces:
  - `savePendingDelete(env, userId, pending: PendingDelete): Promise<void>` — KV key `pending_delete:${userId}`, TTL 3600s (reuse `TTL_SECONDS` or export it).
  - `getPendingDelete(env, userId): Promise<PendingDelete | null>`
  - `clearPendingDelete(env, userId): Promise<void>`
- Import `PendingDelete` type from `./action-safety`.
- `clearMemory` should also clear pending delete for that user.

- [ ] **Step 1: Write failing tests** mocking `env.DEDUP_KV` Map-like get/put/delete.

- [ ] **Step 2: Implement state helpers + clearMemory update**

- [ ] **Step 3: Run** `npx vitest run test/pending-delete-state.test.ts` (and any state tests) — PASS

- [ ] **Step 4: Commit**

```bash
git add src/state.ts test/pending-delete-state.test.ts
git commit -m "feat: KV pending delete for Action Safety"
```

---

### Task 3: Router — multi-create guard + delete confirm (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Interfaces:**
- Consumes: `filterCreateTaskCalls`, `isPositiveDeleteConfirm`, `isNegativeDeleteConfirm`, `savePendingDelete`, `getPendingDelete`, `clearPendingDelete`
- Extend `RouterDeps` with `getPendingDelete`, `savePendingDelete`, `clearPendingDelete` (default to state exports).
- Update `deps()` helper in `test/router.test.ts` with the new mocks.

**Behavior (exact):**

1. **Before processing function_calls in a turn:**  
   `const filtered = filterCreateTaskCalls(reply.calls, payload.text)`  
   - Replace the create_notion_task entries in the working call list with `filtered.allowed`.  
   - If `filtered.blocked`, append `filtered.clarifyMessage` to `replyMessages` / `finalResponse` and do **not** call `createTask` for blocked ones. Other non-create tools in the same turn may still run (rare); prefer dropping only creates.

2. **delete_notion_tasks / delete_notion_notes / delete_notion_memory:**  
   - Resolve matched IDs as today.  
   - If matched IDs length ≥ 1: **do not archive**. Call `savePendingDelete` with kind + ids + short summary. Push confirm text e.g. `Aldo, aku nemu N tugas buat dihapus (...). Yakin? Balas "ya" atau "jangan".`  
   - Single-id keyword delete still requires confirm in V1 (safer; matches success criterion for “hapus semua”; also covers aggressive deletes).

3. **Start of `handleUserMessage` (DM only, after /help|/reset checks):**  
   - `const pending = await deps.getPendingDelete(env, userId)`  
   - If pending and `isPositiveDeleteConfirm(normalizedText)`: archive all `pending.ids`, `clearPendingDelete`, return success count string; **skip Gemini**.  
   - If pending and `isNegativeDeleteConfirm(normalizedText)`: clear pending, return cancel string; **skip Gemini**.  
   - If pending and neither: fall through to Gemini as normal (optional: mention pending still open — YAGNI, skip unless easy).

4. **Clarify short-circuit:** already true today when Gemini returns `type: "text"` — add a regression test that text-only reply never calls `createTask`/`archiveTask`.

5. **Update existing test** `"handles delete_notion_tasks tool call"`: expect `archiveTask` **not** called; expect confirm language; expect `savePendingDelete` called. Add new test: second message `"ya"` with pending → archives.

- [ ] **Step 1: Write/adjust failing router tests** (multi-create block, delete confirm, confirm yes, text-only no writes)

Example multi-create test:

```ts
it("blocks multiple create_notion_task in one turn without explicit multi", async () => {
  const d = deps({
    generateChatReply: vi.fn()
      .mockResolvedValueOnce({
        type: "function_calls",
        calls: [1, 2, 3, 4].map((i) => ({
          name: "create_notion_task",
          args: { title: `Simurelay ${i}`, priority: "Medium" },
        })),
      })
      .mockResolvedValue({ type: "text", text: "ok" }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, {
    text: "Simurelay error\ncek board\nfix wiring\ntest ulang",
  }, d);
  expect(d.createTask).not.toHaveBeenCalled();
  expect(reply).toMatch(/satu|beberapa/i);
});
```

- [ ] **Step 2: Run** `npx vitest run test/router.test.ts` — expect FAIL on new/updated cases

- [ ] **Step 3: Implement router wiring**

- [ ] **Step 4: Run** `npx vitest run test/router.test.ts test/action-safety.test.ts` — PASS

- [ ] **Step 5: Commit**

```bash
git add src/router.ts test/router.test.ts
git commit -m "feat: enforce multi-create and delete confirm in router"
```

---

### Task 4: Gemini Brain prompt rules

**Files:**
- Modify: `src/gemini.ts` (DM branch of `systemPrompt` only; leave `GROUP_CHAT_RULES` as-is)

**Interfaces:**
- No new exports required.
- Insert a short `BRAIN_V1_RULES` string (or inline array joined) into the non-group `systemPrompt` after persona / before tool-selection rules.

Rules content (must include):
- Classify intent: task | inbox | memory | routine | chat | clarify.
- Chat/questions → no Notion create tools.
- Same-topic multi-message / unclear list → one task **or** ask “satu atau beberapa?”; never spam `create_notion_task`.
- Mass delete → ask confirm (code also enforces).
- Clear task + deadline → create immediately (policy B).
- Parallel tools only for clearly distinct user-requested actions, not speculative multi-create.

Also soften/contradict existing line that encourages parallel multi-create when it conflicts — keep parallel for “delete X AND create note Y” style, but add: “Do NOT emit multiple create_notion_task calls for one topic unless the user explicitly listed multiple separate tasks.”

- [ ] **Step 1: Add `BRAIN_V1_RULES` and wire into DM system prompt**

- [ ] **Step 2: Run full unit suite**

Run: `npx vitest run`
Expected: PASS (prompt-only; no test required unless a prompt snapshot test exists — do not add brittle full-prompt snapshots)

- [ ] **Step 3: Commit**

```bash
git add src/gemini.ts
git commit -m "feat: add Youyou Brain v1 intent rules to Gemini prompt"
```

---

### Task 5: Verify + deploy note

**Files:** none required (optional one-line in README if deploy steps already documented — skip if not)

- [ ] **Step 1: Run** `npx vitest run` and `npx tsc --noEmit` (or project’s usual typecheck) — both green

- [ ] **Step 2: Deploy Worker** with `npx wrangler deploy` when user asks (do not deploy secrets changes)

- [ ] **Step 3: Manual DM checklist**
  1. Burst same-topic lines → clarify or 1 task, not 4
  2. “Hapus semua tugas” → confirm; “ya” → archive
  3. “Halo apa kabar” → no Notion write
  4. “Buat tugas X deadline besok jam 8” → creates immediately

- [ ] **Step 4: Final commit** only if leftover doc/fixups; otherwise done

---

## Self-review checklist (author)
- Spec success criteria 1–4 each have a Task 3 or 4 test/manual step.
- No TBD placeholders.
- `PendingDelete` / dep names consistent across Tasks 1–3.
- Existing delete router test updated (not left asserting immediate archive).
