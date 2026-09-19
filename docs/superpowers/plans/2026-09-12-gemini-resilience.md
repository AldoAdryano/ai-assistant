# Intermittent API Error Retry & Fallback Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement robust, idempotent retries for "location unsupported" errors, accurate error classification, and media text-only fallback without touching the bot's persona.

**Architecture:** 
1. **Error Classification:** Define custom error types in `src/gemini.ts` so `router.ts` can distinguish rate limits from location errors.
2. **Idempotency:** Enhance the `executedTools` logic in `src/router.ts` to be keyed per-interaction (or per `updateId` if available), persisting it if necessary, to ensure a retry does not re-run tools.
3. **Retry Loop:** Update the blind 3-attempt loop in `src/router.ts` to specifically target `LOCATION_UNSUPPORTED` with jittered backoff, breaking early for non-retryable errors.
4. **Media Fallback:** If media API fails with location errors after retries but text exists, drop the media and fallback to text-only generation.

**Tech Stack:** TypeScript, Cloudflare Workers.

**Spec:** User spec for resilient error handling.

## Global Constraints

- Do NOT alter `YOUYOU_PERSONA` or any conversational instructions.
- Ensure only maximum ONE final reply is generated per WhatsApp message.
- Limit retry to max 2 attempts (total 3 tries).
- Wait 500-1000ms for retry 1, 1000-2000ms for retry 2.

---

### Task 1: Accurate Error Classification

**Files:**
- Modify: `src/gemini.ts`

**Interfaces:**
- Produces: `GeminiApiError` class extending Error with `type` property.

- [ ] **Step 1: Define Error Class**

Create a custom error class in `src/gemini.ts`:
```typescript
export class GeminiApiError extends Error {
  type: "LOCATION_UNSUPPORTED" | "RATE_LIMIT" | "TIMEOUT" | "MEDIA_ERROR" | "UNKNOWN_ERROR";
  constructor(message: string, type: GeminiApiError["type"]) {
    super(message);
    this.type = type;
  }
}
```

- [ ] **Step 2: Apply Classification**

In `src/gemini.ts`, inside the `!response.ok` blocks of `generateChatReply` and the alarm functions, parse the error response and throw `GeminiApiError` with the correct type. Specifically detect "location is not supported" or HTTP 400 with "current location".

### Task 3: Implement Idempotent Retry Loop & Media Fallback

**Files:**
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: `GeminiApiError`

- [ ] **Step 1: Rewrite Loop in Router**

In `src/router.ts`, find the loop:
`for (let attempt = 1; attempt <= 3; attempt++) { ... }`

Replace it with logic that only retries if `err instanceof GeminiApiError && err.type === "LOCATION_UNSUPPORTED"`. Use jittered timeouts.

- [ ] **Step 2: Add Media Fallback**

Within the retry loop, if the attempt is the final one and it still fails with a media location error, but `payload.text` exists, strip the `imageBase64`/`audioBase64` and attempt ONE last time as text-only.

- [ ] **Step 3: User-facing Error**

Update the final `catch` block in `handleUserMessage`. If it's `LOCATION_UNSUPPORTED`, return `"Maaf, koneksi AI-ku lagi bermasalah sebentar. Coba kirim pesanmu sekali lagi ya."` instead of the technical string. Ensure `console.error` still logs the full diagnostic with attempt numbers.

### Task 4: Prevent Duplicate Execution (Idempotency)

**Files:**
- Modify: `src/router.ts`

**Interfaces:**
- Consumes: Tool execution logic.

- [ ] **Step 1: Tie `executedTools` to Request Lifecycle**

`executedTools` is already a `Set` scoped to the `handleUserMessage` execution. Ensure that if a retry happens (which shouldn't normally hit tool execution, but just in case), the `Set` persists. 

*Self-correction/Note:* The current loop in `router.ts` executes tools *after* the fetch loop succeeds. Therefore, if fetch fails and retries, tools have not been executed yet. We just need to ensure that the `continueLoop` doesn't accidentally cause dual executions if a timeout occurs mid-stream. Ensure `executedTools` validation is robust.

- [ ] **Step 2: Add Tests**

Add the requested tests (Test B, C, D, E, F) to `test/router.test.ts` (or equivalent) to prove retry and fallback work without double execution.