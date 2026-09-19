# AI Sticker Reaction Support Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Youyou to send pure AI-generated sticker reactions even when the user did not send a photo.

**Architecture:** 
1. **Bridge Logic (`whatsapp.js`):** Modify the `[SYSTEM_ACTION: MAKE_STICKER]` handler. If `lastMedia` is missing but a `caption` is provided, interpret the caption as a "reaction type" (e.g., "marah") and load a local WebP template (`whatsapp-bridge/stickers/marah.webp`).
2. **Template Creation:** Use a small script to generate dummy WebP stickers for basic emotions so the bridge doesn't crash on `fs.readFileSync`.
3. **Persona Update (`gemini.ts`):** Teach Youyou the available reaction types so she uses the correct syntax.

**Tech Stack:** Node.js, Baileys, Sharp (for creating dummy WebPs).

**Spec:** Fix the issue where Youyou cannot send stickers back unless the user sends an image first.

## Global Constraints

- Must run in Node.js / Cloudflare Workers environment.
- Create dummy `.webp` templates programmatically using `sharp` to ensure the files exist.

---

### Task 1: Create Dummy Sticker Templates

**Files:**
- Create: `whatsapp-bridge/scripts/create-dummy-stickers.js`

**Interfaces:**
- Produces: `whatsapp-bridge/stickers/marah.webp`, `senang.webp`, `ngambek.webp`, `sedih.webp`, `default.webp`

- [ ] **Step 1: Write generation script**

Create a Node.js script using `sharp` that generates 5 colored 512x512 squares with text (marah, senang, ngambek, sedih, default) and saves them as `.webp` in `whatsapp-bridge/stickers/`.

- [ ] **Step 2: Run the script**

Execute the script to physically create the files on disk.

### Task 2: Update Bridge Sticker Logic

**Files:**
- Modify: `whatsapp-bridge/src/whatsapp.js`

**Interfaces:**
- Consumes: Regex `[SYSTEM_ACTION: MAKE_STICKER caption="..."]`
- Produces: Sends local WebP if no `lastMedia` is present.

- [ ] **Step 1: Modify `MAKE_STICKER` handling**

Locate the `stickerMatch` logic in `whatsapp-bridge/src/whatsapp.js`.
Change the `if (mediaInfo)` block to:
```javascript
const fs = require('fs');
const path = require('path');

if (mediaInfo) {
  // Existing logic: buildImageSticker / buildVideoSticker
} else {
  // New logic: Reaction Sticker
  let reactionType = caption ? caption.toLowerCase().trim() : "default";
  let templatePath = path.join(__dirname, '..', 'stickers', `${reactionType}.webp`);
  
  if (!fs.existsSync(templatePath)) {
    templatePath = path.join(__dirname, '..', 'stickers', 'default.webp');
  }
  
  try {
     const stickerBuffer = fs.readFileSync(templatePath);
     // Wrap it in wa-sticker-formatter to ensure WhatsApp accepts it as a sticker
     const { Sticker, StickerTypes } = require('wa-sticker-formatter');
     const sticker = new Sticker(stickerBuffer, {
       pack: 'Youyou AI', 
       author: 'Tuan Muda Aldo', 
       type: StickerTypes.FULL, 
       quality: 50
     });
     const finalBuffer = await sticker.build();
     await sock.sendMessage(msg.key.remoteJid, { sticker: finalBuffer });
     console.log(`[DEBUG] Template Sticker sent: ${reactionType}`);
  } catch (err) {
     console.error("[ERROR] Failed to send template sticker", err);
     await sock.sendMessage(msg.key.remoteJid, { text: "Stikernya nyangkut!" });
  }
}
```

### Task 3: Teach Youyou the Templates

**Files:**
- Modify: `src/gemini.ts`

**Interfaces:**
- Consumes: `YOUYOU_PERSONA`

- [ ] **Step 1: Update Persona Prompt**

In `src/gemini.ts`, modify `YOUYOU_PERSONA`:
Change the sticker instruction to:
`"Jika kamu ingin membalas dengan stiker ekspresimu sendiri (tanpa foto dari user), kamu WAJIB menggunakan tag [SYSTEM_ACTION: MAKE_STICKER caption=\"jenis_ekspresi\"] di akhir pesan. Pilihan ekspresi yang tersedia HANYA: marah, senang, ngambek, sedih. Contoh: [SYSTEM_ACTION: MAKE_STICKER caption=\"marah\"]."`