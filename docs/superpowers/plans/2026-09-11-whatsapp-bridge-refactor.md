# WhatsApp Bridge Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the `whatsapp-bridge` monolith into modular components, introduce request queuing, and improve error handling.

**Architecture:** Split `index.js` into distinct files for config, media processing, WhatsApp connection, and polling. Introduce an in-memory queue (`p-queue`) to control concurrent sticker generation.

**Tech Stack:** Node.js, `@whiskeysockets/baileys`, `wa-sticker-formatter`, `fluent-ffmpeg`, `p-queue`.

**Spec:** Refactor WhatsApp Bridge to fix monolith, lack of queues, and poor error handling.

## Global Constraints

- Must run in Node.js environment.
- Preserve existing Baileys connection logic.
- Avoid introducing heavy database dependencies (use in-memory tools for now).
- All new files go into `whatsapp-bridge/src/`.

---

### Task 1: Setup and Configuration

**Files:**
- Create: `whatsapp-bridge/src/config.js`
- Modify: `whatsapp-bridge/package.json`

**Interfaces:**
- Produces: `getConfig()` returning validated environment variables.

- [ ] **Step 1: Install `p-queue`**

```bash
cd whatsapp-bridge
npm install p-queue
```

- [ ] **Step 2: Create config module**

Create `whatsapp-bridge/src/config.js`:
```javascript
require('dotenv').config();

function getConfig() {
  const WORKER_URL = process.env.WORKER_URL;
  const WHATSAPP_API_SECRET = process.env.WHATSAPP_API_SECRET;
  const ALLOWED_WHATSAPP_NUMBER = process.env.ALLOWED_WHATSAPP_NUMBER;

  if (!WORKER_URL || !WHATSAPP_API_SECRET || !ALLOWED_WHATSAPP_NUMBER) {
    throw new Error("Missing required environment variables");
  }

  const targetJid = ALLOWED_WHATSAPP_NUMBER.includes('@') 
    ? ALLOWED_WHATSAPP_NUMBER 
    : `${ALLOWED_WHATSAPP_NUMBER}@s.whatsapp.net`;

  return { WORKER_URL, WHATSAPP_API_SECRET, ALLOWED_WHATSAPP_NUMBER, targetJid };
}

module.exports = { getConfig };
```

- [ ] **Step 3: Test config logic**

Run: `node -e "const { getConfig } = require('./whatsapp-bridge/src/config'); console.log(getConfig());"`
Expected: Output of the parsed environment variables (assuming `.env` is present).

### Task 2: Extract Media Processing

**Files:**
- Create: `whatsapp-bridge/src/media.js`

**Interfaces:**
- Consumes: Raw media buffers.
- Produces: `buildImageSticker(buffer, caption)`, `buildVideoSticker(buffer, caption)`.

- [ ] **Step 1: Extract FFmpeg and Sticker logic**

Create `whatsapp-bridge/src/media.js` and move the `buildImageSticker` and `buildVideoSticker` functions from `index.js`. Ensure imports (`sharp`, `ffmpeg-static`, `wa-sticker-formatter`, `path`, `fs`, `os`, `child_process`) are included.

- [ ] **Step 2: Add Queue**

In `whatsapp-bridge/src/media.js`, integrate `p-queue` to limit concurrent FFmpeg executions:

```javascript
// ... imports ...
const { default: PQueue } = require('p-queue');
const queue = new PQueue({ concurrency: 2 });

// wrap buildImageSticker and buildVideoSticker content inside queue.add()
async function buildImageSticker(buffer, caption) {
  return queue.add(async () => {
     // ... original logic ...
  });
}
// repeat for buildVideoSticker
```

- [ ] **Step 3: Verify module structure**

Check syntax: `node -c whatsapp-bridge/src/media.js`

### Task 3: Extract WhatsApp Logic

**Files:**
- Create: `whatsapp-bridge/src/whatsapp.js`

**Interfaces:**
- Consumes: `getConfig()`, `buildImageSticker`, `buildVideoSticker`.
- Produces: `startWhatsApp()`.

- [ ] **Step 1: Move Baileys setup**

Create `whatsapp-bridge/src/whatsapp.js`. Move the `startWhatsApp` function, `lastMedia` store, and `startPolling` logic here. Update internal references to use the extracted modules.

```javascript
const { getConfig } = require('./config');
const { buildImageSticker, buildVideoSticker } = require('./media');
// ... original baileys imports ...
```

- [ ] **Step 2: Add error handling to message processing**

Enhance the `catch` blocks inside the `messages.upsert` handler to log structured errors and prevent crash loops.

### Task 4: Create Entry Point

**Files:**
- Modify: `whatsapp-bridge/index.js`

**Interfaces:**
- Consumes: `startWhatsApp()`.

- [ ] **Step 1: Simplify `index.js`**

Rewrite `whatsapp-bridge/index.js` to just bootstrap the app:

```javascript
const { startWhatsApp } = require('./src/whatsapp');

console.log("Starting WhatsApp Bridge...");
startWhatsApp().catch(err => {
  console.error("Fatal error starting bridge:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run application**

Run: `node whatsapp-bridge/index.js` (with a valid `.env`) to ensure it boots up correctly and awaits QR scan or connects.
