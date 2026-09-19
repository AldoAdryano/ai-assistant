# Context Manager v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track current vs previous DM conversation topic in KV; inject into Gemini; switch via explicit phrases or `set_conversation_topic` tool so Youyou does not stick to old topics.

**Architecture:** Pure helpers in `conversation-context.ts`; KV in `state.ts`; router applies phrase detect (DM only) and tool handler; Gemini gets CURRENT/PREVIOUS TOPIC + anti-stickiness rules + new tool.

**Tech Stack:** Cloudflare Worker TypeScript, Vitest, `DEDUP_KV`.

**Spec:** `docs/superpowers/specs/2026-09-19-youyou-context-manager-v1-design.md`

## Global Constraints
- **DM only** — skip all context-manager logic when `chatContext === "group"`.
- Hybrid detection: code phrases + Gemini tool; do not switch on deadline-only replies (`besok`, etc.) when detecting phrases.
- Do not regress Brain v1 / Memory 2.0 confirm flows.
- Deploy: Worker only.
- Youyou-tone Indonesian where user-facing (optional ack on explicit switch is OK but YAGNI — silent KV update + model behavior is enough).

---

### Task 1: Pure conversation-context helpers (TDD)

**Files:**
- Create: `src/conversation-context.ts`
- Create: `test/conversation-context.test.ts`

**Interfaces:**
```ts
export type ConversationContext = {
  currentTopic: string;
  previousTopic: string | null;
  activeTaskHint: string | null;
  updatedAt: number;
};

export function applyTopicSwitch(
  prev: ConversationContext | null,
  newTopic: string,
  now?: number,
): ConversationContext;

/** If explicit switch phrase matched, return new topic label (may be trimmed remainder or "general"). */
export function detectExplicitTopicSwitch(userText: string): { topic: string } | null;

/** True if message looks like deadline-only clarification (should not force topic switch via phrases). */
export function isDeadlineOnlyReply(userText: string): boolean;
```

- Phrases: `pindah topik`, `ganti topik`, `topik baru`, `kita bahas yang lain`, `bahas yang lain` (and light variants).
- If phrase matched but `isDeadlineOnlyReply` → return null (no switch).
- `applyTopicSwitch`: previous = old current (or null); current = trimmed newTopic; keep activeTaskHint unless clearing on switch (clear hint on switch for v1).

- [ ] Failing tests → implement → PASS
- [ ] Commit: `feat: conversation-context helpers for Context Manager v1`

---

### Task 2: KV state (TDD)

**Files:**
- Modify: `src/state.ts`
- Create: `test/conversation-context-state.test.ts`

**Interfaces:**
- `saveConversationContext(env, userId, ctx)` — key `conversation_context:${userId}`, TTL = `CHAT_LOG_TTL_SECONDS` (7d)
- `getConversationContext` / `clearConversationContext`
- `clearMemory` also clears conversation context

- [ ] TDD → Commit: `feat: KV conversation context state`

---

### Task 3: Gemini inject + tool (TDD where useful)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts` if prompt/tool assertions exist; else light unit test for `formatConversationContextForPrompt`

**Interfaces:**
- Extend `generateChatReply` context: `conversation?: ConversationContext | null`
- DM systemPrompt: inject `CURRENT TOPIC` / `PREVIOUS TOPIC` + anti-stickiness rules (skip in group)
- Add tool `set_conversation_topic` `{ topic: string, reason?: string }` — DM tools only
- Export `formatConversationContextForPrompt(ctx: ConversationContext | null): string`

- [ ] Implement + tests green
- [ ] Commit: `feat: inject conversation topic into Gemini prompt`

---

### Task 4: Router wiring (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Behavior (DM only):**
1. After pending delete/memory confirms (unchanged), before Gemini:
   - `detectExplicitTopicSwitch(text)` → if hit, `applyTopicSwitch` + `saveConversationContext`
2. Load context; pass into `generateChatReply`
3. On tool `set_conversation_topic`: apply switch + save; push short system ack to tool loop (`[System]: topic set to …`) so model continues
4. Group: never load/save conversation context; never expose tool

**Tests:**
1. “pindah topik belanja kaos” → saveConversationContext with current belanja-ish, previous preserved from prior mock get
2. User text “besok” alone → detectExplicitTopicSwitch null; no save from phrase path
3. set_conversation_topic tool → saveConversationContext called
4. Group message → getConversationContext / save not used for topic (or not called)
5. Existing memory/delete confirm tests still pass

- [ ] Commit: `feat: wire Context Manager into router (DM only)`

---

### Task 5: Verify + deploy

- [ ] `npx vitest run` PASS
- [ ] `npx wrangler deploy`
- [ ] Manual DM: drone → pindah topik belanja → no drone nag; “besok” after task ask does not wipe topic wrongly

---

## Self-review
- Spec SC 1–4 covered
- DM-only enforced in Task 4
- No TBD
