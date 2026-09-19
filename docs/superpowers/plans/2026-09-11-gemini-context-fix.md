# Gemini API Harmonization and Context Injection Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify Gemini API calls to `generateContent` and inject active memory/tasks into proactive/routine alarms.

**Architecture:** Refactor `src/gemini.ts` to strictly use the `generateContent` endpoint for all interactions (text, media, alarms). Extract common logic for persona injection, context injection, and `extractReply` simplifications. Add parsing for function calls directly in `generateContent` response payload. Update alarms to receive memory and task context.

**Tech Stack:** TypeScript, Cloudflare Workers, Fetch API, Gemini `v1beta:generateContent`.

**Spec:** Fix amnesia in proactive alarms by pulling memory records, unify the Gemini API endpoint, and clean up Markdown tags.

## Global Constraints

- Must run in Cloudflare Workers (TypeScript).
- Do not remove the "Youyou" persona or constraints.
- Replace `/v1/interactions` with `v1beta/models/...:generateContent` for text.
- Alarms must receive `context: { tasks: TaskRecord[]; memories: MemoryRecord[] }` to not be "blind".
- Clean Markdown: automatically remove strict `**` bolding and swap to `*` to match WhatsApp styling if possible, though Gemini prompts should just request it.

---

### Task 1: Unify the Gemini Endpoint

**Files:**
- Modify: `src/gemini.ts`

**Interfaces:**
- Consumes: User message.
- Produces: `generateChatReply` using `generateContent`.

- [ ] **Step 1: Remove `/v1/interactions`**

In `src/gemini.ts`, delete the `interact` function. Modify `generateChatReply` so it always uses the `generateContent` endpoint format (the one currently used for images `mediaPayload`).

- [ ] **Step 2: Simplify `extractReply`**

Since `generateContent` has a more predictable format (`data.candidates[0].content.parts`), update `extractReply()` to parse `functionCall` and `text` from this standard response.

- [ ] **Step 3: Update `ChatReply` return structure**
Ensure it returns the same `{ type: "text", text: string }` or `{ type: "function_calls", calls: [...] }`.

### Task 2: Inject Context into Alarms

**Files:**
- Modify: `src/gemini.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `generateProactiveAlarm`, `generateRoutineAlarm`.
- Produces: Alarms aware of memory.

- [ ] **Step 1: Update Alarm Signatures in `src/gemini.ts`**

Modify `generateProactiveAlarm` and `generateRoutineAlarm` to accept the full `context: { tasks: TaskRecord[]; memories: MemoryRecord[] }` parameter (like `generateChatReply`).

- [ ] **Step 2: Inject into System Prompt**

Inside `generateProactiveAlarm` and `generateRoutineAlarm`, append the memory lines to the system instruction so Youyou remembers constraints (e.g., "Aldo sedang sakit").

- [ ] **Step 3: Update Worker Scheduler in `src/index.ts`**

In `src/index.ts` inside `runScheduled`, fetch `getActiveMemory` (or similar) and pass the `context` to the alarm generation functions.

### Task 3: Improve Response Filtering (Markdown)

**Files:**
- Modify: `src/router.ts` (or wherever `sendTelegramText`/Worker replies are formatted before sending to bridge).

**Interfaces:**
- Consumes: Raw text from Gemini.
- Produces: Text formatted for WhatsApp.

- [ ] **Step 1: Sanitize Telegram Markdown**

Create a helper function to sanitize `**bold**` to `*bold*` if the Gemini API still disobeys the persona prompt. Apply it before sending the message down the pipeline.