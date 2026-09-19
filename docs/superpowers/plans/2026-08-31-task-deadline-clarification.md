# Task Deadline Parsing + Clarification Implementation Plan

> **For agentic workers:** Execute this plan task-by-task with TDD and
> review checkpoints. Do not combine independent tasks.

**Goal:** Add deterministic Indonesian task deadline parsing, Notion Due writes, and safe multi-turn clarification without regressing the accepted Telegram assistant V1.

**Architecture:** Put deterministic date interpretation in a focused date module (`src/date.ts`). Use a unified boundary (`normalizeTaskIntent`) to resolve deadlines for ALL `ADD_TASK` intents regardless of whether they originated from the deterministic parser or Gemini classification. Abstract clarification state into a dedicated KV module (`src/pending-task.ts`) using existing DEDUP_KV. Extend router and index to pass user ID into orchestration. Keep Notion schema unchanged.

**Tech Stack:** TypeScript, Cloudflare Workers, Workers KV, Vitest, Telegram Bot API, Notion API.

**Spec:** docs/superpowers/specs/2026-08-31-task-deadline-clarification-design.md

## Global Constraints
- Timezone: Asia/Jakarta.
- Date parsing is deterministic; Gemini is not used for date parsing.
- Reference time/date must be injectable/testable.
- Clarification TTL: 15 minutes.
- Existing DEDUP_KV is reused.
- No new storage service.
- No Notion schema change.
- No Cloudflare Cron.
- No reminder scheduling.
- No Google Calendar.
- No recurring tasks.
- No task editing/deleting.
- No time-of-day parsing.
- Single authorized Telegram user remains the V1 model.
- Existing Telegram security and update_id dedupe behavior must remain.
- Existing Gemini, Inbox, Memory, and Tasks list behavior must remain.
- No secret may be logged.
- Existing safe Notion/Gemini diagnostic instrumentation stays intact.

*Current accepted baseline before implementation: 8 test files / 59 tests PASS. Do not claim that baseline is still current unless implementation phase runs it freshly.*

## File-Boundary Design
Based on inspection of the current repository, the architecture is bounded as follows:

**CREATE:**
- `src/date.ts`: Handles timezone/reference-date normalization, deterministic Indonesian deadline recognition, calendar arithmetic.
- `test/date.test.ts`: TDD tests for date semantics.
- `src/pending-task.ts`: Dedicated KV module handling key construction (`pending-task:<telegram-user-id>`), 900s TTL, state discriminated union (AWAITING_CLARIFICATION, READY, PROCESSING, UNKNOWN_OUTCOME, COMPLETED), and safe state transitions.
- `test/pending-task.test.ts`: TDD tests for KV logic, failure modes, and transitions.

**MODIFY:**
- `src/types.ts`: Define exact date parse results.
- `src/parser.ts`: Refactor text cleaning and provide the exact boundary: `normalizeTaskIntent(intent: ParsedIntent, originalText: string, referenceDate: Date): NormalizedTaskResult`.
- `src/notion.ts`: Explicit Notion outcome classification (SUCCESS, DEFINITE_REJECTION, UNKNOWN_OUTCOME) and optional `Due` payload.
- `src/router.ts`: Update `handleUserText` signature to accept `userId: number` and `env: Env`. Delegate KV operations to `pending-task.ts`.
- `src/index.ts`: Pass `message.userId` and `env` from the webhook context into `handleUserText`.

**TEST:**
- `test/parser.test.ts`: Test task text cleaning and deadline extraction via unified normalization boundary.
- `test/router.test.ts`: Test state machine orchestration, continuation logic, and command precedence.
- `test/webhook.test.ts`: Verify full end-to-end webhook integration with user-id binding and duplicate update handling.
- `test/notion.test.ts`: Verify Notion HTTP payload and exact error classifications.

*Decision on natural phrasing:* The V1 architecture uses Gemini fallback (`classifyIntent`) to recognize natural sentences like `"Tugas kuliah mata pelajaran... deadline hari senin depan"`. To properly resolve deadlines without breaking existing behavior, `normalizeTaskIntent` will be applied in `router.ts` on ALL `ADD_TASK` intents AFTER the fallback classification occurs, ensuring Gemini and deterministic rules share identical date semantics.

---

## Task 1: Date primitives
**Files**
- Create: `src/date.ts`, `test/date.test.ts`
- Modify: `src/types.ts` (Add `DeadlineParseResult`)

**Interfaces**
- Consumes: Native JS `Date`, injected reference date.
- Produces: `parseIndonesianDeadline(input: string, referenceDate: Date, timezone: "Asia/Jakarta"): DeadlineParseResult`

- [ ] Write failing test for basic exact matches ("besok", "hari ini").
- [ ] Run focused test and verify RED.
- [ ] Implement minimal production code for relative day offsets.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 2: Concrete/weekday date semantics
**Files**
- Modify: `src/date.ts`, `test/date.test.ts`

**Interfaces**
- Consumes: Same as Task 1.
- Produces: Enhanced `parseIndonesianDeadline`.

- [ ] Write failing tests for bare weekdays ("Senin" -> +7 on Monday, "Selasa" -> +1).
- [ ] Write failing tests for "<weekday> depan" (next calendar week).
- [ ] Write failing tests for explicit numeric formats and day+month year inference (nearest future).
- [ ] Run focused test and verify RED.
- [ ] Implement production code resolving these rules.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 3: Ambiguous date + continuation resolution
**Files**
- Modify: `src/date.ts`, `test/date.test.ts`

**Interfaces**
- Produces: `DeadlineParseResult` with `kind: "needs_clarification"` and exact `reason` ("missing_month" or "missing_weekday").

- [ ] Write failing tests for missing month ("tanggal 5") yielding `needs_clarification`.
- [ ] Write failing tests for case-insensitive missing weekday-for-next-week ("minggu depan" / "Minggu depan") yielding `needs_clarification`.
- [ ] Write failing tests for explicit disambiguation ("hari Minggu depan" -> resolved).
- [ ] Write failing tests for continuation answers (e.g., resolving "Kamis" inside next calendar week).
- [ ] Run focused test and verify RED.
- [ ] Implement production code for clarification extraction and resolution.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 4: Unified task normalization for deterministic + Gemini ADD_TASK
**Files**
- Modify: `src/parser.ts`, `test/parser.test.ts`

**Interfaces**
- Consumes: `parseIndonesianDeadline`.
- Produces: `normalizeTaskIntent(intent: ParsedIntent, originalText: string, referenceDate: Date): NormalizedTaskResult`
- Types: `NormalizedTaskResult` defining `{ kind: "ready" | "needs_clarification", taskText, priority, due?, clarificationReason?, partialDate? }`.

- [ ] Write failing tests for stripping deadline markers alongside priority markers.
- [ ] Write regression test for the exact real-world phrasing: `"Tugas kuliah mata pelajaran praktikum instalasi dan mesin listrik: membuat laprak pertemuan pertama, deadline hari senin depan"` correctly resolving via this unified boundary.
- [ ] Run focused test and verify RED.
- [ ] Implement production code that cleans task text and structures the boundary result cleanly.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 5: Notion Due + outcome classification
**Files**
- Modify: `src/notion.ts`, `test/notion.test.ts`

**Interfaces**
- Consumes: `task.due?: string` in `createTask`.
- Produces: `createTask` returning a classified outcome wrapper instead of just a string ID, e.g. `{ status: "SUCCESS" | "DEFINITE_REJECTION" | "UNKNOWN_OUTCOME", id?: string }`.

- [ ] Write failing tests for optional `Due` payload omission when absent.
- [ ] Write failing tests for mapping 400/403 to `DEFINITE_REJECTION` and 500/fetch exceptions to `UNKNOWN_OUTCOME`.
- [ ] Run focused test and verify RED.
- [ ] Implement minimal production code classifying the HTTP result safely.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 6: Pending-task KV module/state machine
**Files**
- Create: `src/pending-task.ts`, `test/pending-task.test.ts`
- Modify: `src/types.ts`

**Interfaces**
- Consumes: `env.DEDUP_KV`.
- Produces: Functions `getPendingTask`, `setPendingTaskState`, `deletePendingTask`.
- Types: Pending states `AWAITING_CLARIFICATION | READY | PROCESSING | UNKNOWN_OUTCOME | COMPLETED` with stable `operationId` and user-scoped keys.

- [ ] Write failing tests simulating KV read/write failures and ensuring stable `pending-task:<userId>` key schema.
- [ ] Write failing tests for safe state transitions and 900s TTL logic.
- [ ] Run focused test and verify RED.
- [ ] Implement minimal production code for state serialization and CRUD.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 7: Router/index orchestration + userId
**Files**
- Modify: `src/index.ts`, `src/router.ts`, `test/router.test.ts`

**Interfaces**
- Consumes: `normalizeTaskIntent`, `src/pending-task.ts`.
- Produces: `handleUserText(config, env, userId, text, deps)` integrating all orchestration.

- [ ] Write failing tests in `router.test.ts` simulating precedence: existing state intercepts text *before* deterministic parsing UNLESS it's a known explicit command.
- [ ] Write failing tests for full state machine transitions and `UNKNOWN_OUTCOME` preventing automatic retries.
- [ ] Write minimal test in `src/index.ts` (if applicable) verifying `env` and `message.userId` pass through correctly.
- [ ] Run focused test and verify RED.
- [ ] Implement production code in index and router orchestrating everything.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 8: Webhook/routing edge-case integration
**Files**
- Modify: `test/webhook.test.ts`

**Interfaces**
- Consumes: Full webhook router pipeline.

- [ ] Write failing tests for duplicate `update_id` while in `PROCESSING` and `COMPLETED` states (zero second create).
- [ ] Write failing tests for /help during a pending clarification (returns help, pending state remains).
- [ ] Write failing tests for missing month/weekday responses returning clarification reprompt without Notion write.
- [ ] Run focused test and verify RED.
- [ ] Implement minimal safeguards in `router.ts` if failing.
- [ ] Run focused test and verify GREEN.
- [ ] Run relevant regression/typecheck.
- [ ] Review task against spec.

## Task 9: Regression/deploy/smoke gate
**Files**
- Consumes: All tests.

- [ ] Run `npx.cmd tsc --noEmit -p tsconfig.json`
- [ ] Run `npx.cmd tsc --noEmit -p test/tsconfig.json`
- [ ] Run `npm.cmd test` and verify ALL files and tests PASS (zero regression).
- [ ] Perform Production Smoke Test Matrix:
      1. Tambah tugas smoke tanpa deadline
      2. Tambah tugas smoke deadline besok
      3. Original natural sentence regression ("Tugas kuliah... deadline hari senin depan")
      4. Clarification "tanggal 5" -> "September"
      5. Clarification "minggu depan" -> "Kamis"
      6. "deadline hari Minggu depan" explicit test
      7. /help during clarification
      8. Ordinary Gemini chat
      9. Unsupported image
- [ ] Review task against spec.
- [ ] Deploy to production: `cmd.exe /c "npm run deploy"`
