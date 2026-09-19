# Sticker Response & Emoji Enrichment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Youyou to respond to incoming stickers and enrich her prompt to use more emojis and sticker replies.

**Architecture:** 
1. **WhatsApp Bridge (`whatsapp-bridge/src/whatsapp.js`):** Intercept `stickerMessage`. Do not download the sticker payload, but set `text = "[User mengirimkan sebuah ekspresi stiker]"` so the bridge forwards it to the worker instead of silently dropping it.
2. **Cloudflare Worker (`src/gemini.ts`):** Modify the `YOUYOU_PERSONA` to encourage expressive emoji use and explicitly permit returning `[SYSTEM_ACTION: MAKE_STICKER]` to react to user stickers.

**Tech Stack:** JavaScript, TypeScript.

**Spec:** Fix the bug where incoming stickers are ignored and make Youyou more expressive with emojis and sticker responses.

## Global Constraints

- Must run in Node.js / Cloudflare Workers environment.
- Do not attempt to download WebP sticker blobs in `whatsapp.js` to avoid crashing Gemini or FFmpeg. Pass them as text context instead.

---

### Task 1: Intercept Sticker Messages

**Files:**
- Modify: `whatsapp-bridge/src/whatsapp.js`

**Interfaces:**
- Consumes: Incoming Baileys messages.
- Produces: Text context `"[User mengirimkan sebuah ekspresi stiker]"` when a sticker is received.

- [ ] **Step 1: Add Sticker Message Check**

In `whatsapp-bridge/src/whatsapp.js`, locate the message parsing logic (around line 70-115).
Add a condition to check for `msg.message.stickerMessage`.
If it exists, set `text = "[User mengirimkan sebuah ekspresi stiker]"`.

### Task 2: Enrich Youyou's Persona

**Files:**
- Modify: `src/gemini.ts`

**Interfaces:**
- Consumes: `YOUYOU_PERSONA`.
- Produces: Updated prompt.

- [ ] **Step 1: Update Persona Prompt**

In `src/gemini.ts`, edit the `YOUYOU_PERSONA` string.
- Remove the strict "JANGAN PERNAH membuat stiker" negative framing.
- Add: "Gunakan banyak emoji ekspresif (😡, 😤, 🙄, 😳, dll) yang sesuai dengan karaktermu."
- Add: "Jika user mengirimkan '[User mengirimkan sebuah ekspresi stiker]', kamu bisa bereaksi mengomentarinya. Jika kamu ingin membalas dengan stiker ekspresimu sendiri, tambahkan tag [SYSTEM_ACTION: MAKE_STICKER caption=\"ekspresi_singkat\"] di akhir pesanmu."