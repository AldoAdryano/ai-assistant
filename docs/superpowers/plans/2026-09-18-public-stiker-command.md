# Public `/stiker` Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Open WhatsApp bridge to all chats for `/stiker`-only stickers; keep full Youyou for owner (DM always; group via @ or reply-to-bot).

**Architecture:** Pure policy helpers in bridge; `whatsapp.js` routes guest `/stiker` locally (no Worker) and gates owner group chat.

**Tech Stack:** Node.js, Baileys, existing `media.js` converters.

**Spec:** `docs/superpowers/specs/2026-09-18-public-stiker-command-design.md`

## Global Constraints
- Guest path never calls Worker/Gemini.
- Guest success = sticker only; wrong usage = silent.
- Owner alarms still only to `targetJid`.

---

### Task 1: Access + `/stiker` helpers (TDD)

**Files:**
- Create: `whatsapp-bridge/src/access-policy.js`
- Create: `whatsapp-bridge/src/public-stiker.js`
- Create: `test/public-stiker-access.test.ts` (via createRequire)

- [ ] Write failing tests for `normalizeJid`, `isStikerCommand`, `resolveMessageAccess`
- [ ] Implement helpers until green

### Task 2: Wire `whatsapp.js`

- [ ] Accept non-owner messages
- [ ] Detect group, owner, mentions, reply-to-bot
- [ ] Guest `/stiker` → download media → `buildAndSendSticker` (no text)
- [ ] Owner group only if @ or reply-to-bot; owner DM unchanged
- [ ] Update `TERMUX-S4.md` briefly

### Task 3: Verify

- [ ] `npm test` passes
- [ ] Manual: copy `whatsapp.js` + new src files to phone
