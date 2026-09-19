# WhatsApp Personal Assistant V1 — Design Specification

Date: 2026-08-30
Status: Approved in-chat design, implementation not started

## 1. Goal

Build a zero-subscription personal assistant reachable from WhatsApp using Meta's official WhatsApp Cloud API test number. The assistant must run without a dedicated PC/VPS and support four core behaviors:

1. General AI chat.
2. Save notes/ideas to Notion.
3. Add and list tasks from Notion.
4. Store and retrieve explicit user memory/profile facts.

V1 is intentionally limited to text messages. Calendar, web research, PDFs, voice notes, autonomous browsing, and background agents are out of scope.

## 2. Architecture

```text
User WhatsApp
    |
    v
Meta WhatsApp Cloud API (test number)
    |
    v
Cloudflare Worker
    |-- webhook verification + signature check
    |-- sender allowlist
    |-- duplicate-message protection
    |-- deterministic command parser
    |-- intent router
    |
    +--> Gemini API (general chat / ambiguous intent classification)
    |
    +--> Notion API
           |-- Inbox data source
           |-- Tasks data source
           +-- Memory data source

Cloudflare KV
    +-- processed WhatsApp message IDs (short TTL)
```

The Notion workspace is the persistent user-facing memory. Cloudflare KV is only internal infrastructure for webhook idempotency; it is not a second-brain store.

## 3. Technology choices

### WhatsApp

Use Meta WhatsApp Cloud API, not browser automation or unofficial WhatsApp libraries. During V1, use the Meta-provided test phone number. The user's own WhatsApp number is added as an approved test recipient.

### Backend

Use Cloudflare Workers Free. Implement the Worker in TypeScript using native `fetch`, minimizing dependencies and CPU overhead.

### AI

Default model: `gemini-2.5-flash-lite` through the Gemini Developer API. Keep the model name configurable via `GEMINI_MODEL` so it can be changed without code edits.

Gemini is used only when necessary. Deterministic commands should bypass Gemini when possible to reduce quota use and failure modes.

### Storage

Use Notion API version `2026-03-11` and data source IDs. Use Cloudflare KV for message deduplication with TTL.

## 4. WhatsApp message flow

### Webhook verification

`GET /webhook` handles Meta webhook verification using `hub.verify_token` and `hub.challenge`.

### Incoming message

`POST /webhook` performs this sequence:

1. Verify `X-Hub-Signature-256` with `META_APP_SECRET`.
2. Parse the webhook envelope.
3. Ignore status callbacks and unsupported message types.
4. Verify the sender matches `ALLOWED_WHATSAPP_NUMBER`.
5. Check the WhatsApp message ID in KV.
6. If already processed, return success without re-running actions.
7. Store message ID in KV with a short expiration.
8. Acknowledge Meta quickly.
9. Process the message asynchronously.
10. Send a WhatsApp text reply through the Cloud API.

A `/health` endpoint returns a minimal health response and does not expose secrets.

## 5. Intent model

The internal action types are:

- `CHAT`
- `ADD_NOTE`
- `ADD_TASK`
- `LIST_TASKS`
- `REMEMBER`
- `RECALL`
- `HELP`
- `UNKNOWN`

### Deterministic parsing first

Clear phrases are parsed without Gemini, for example:

- "catat ..." -> `ADD_NOTE`
- "simpan ide ..." -> `ADD_NOTE`
- "tambah tugas ..." -> `ADD_TASK`
- "apa tugas saya" -> `LIST_TASKS`
- "daftar tugas" -> `LIST_TASKS`
- "ingat bahwa ..." -> `REMEMBER`
- "apa yang kamu ingat tentang ..." -> `RECALL`
- "bantuan" -> `HELP`

### Gemini fallback

If no deterministic rule is confident, Gemini receives the user's text plus a compact schema and returns structured JSON with one action type and extracted fields. If the action is `CHAT`, Gemini produces the final conversational response using relevant Memory records supplied by the Worker.

The assistant must not claim that a Notion write succeeded unless Notion returned success.

## 6. Notion data model

### Inbox

Purpose: notes and ideas.

Properties:

- `Name` — title
- `Type` — select: Idea, Note
- `Content` — rich text
- `Source` — select: WhatsApp
- `Created` — created time

### Tasks

Purpose: actionable work items.

Properties:

- `Task` — title
- `Status` — select: To Do, Doing, Done
- `Priority` — select: Low, Medium, High
- `Due` — date, optional
- `Source` — select: WhatsApp
- `Created` — created time

Default values for a new task:

- Status = `To Do`
- Priority = `Medium`
- Due = null unless explicitly stated

### Memory

Purpose: stable facts the user explicitly asks the assistant to remember.

Properties:

- `Key` — title
- `Value` — rich text
- `Category` — select: Profile, Preference, Project, Other
- `Updated` — last edited time

V1 does not silently extract or save every personal detail from normal chat. Persistent memory is written only when the user clearly asks to remember/store it.

## 7. Example behaviors

### Note

User: `Catat ide: bahas dark pattern dalam perlindungan konsumen.`

Assistant: `Sudah saya simpan ke Inbox sebagai ide.`

### Task

User: `Tambah tugas cari 5 jurnal tentang dark pattern, prioritas tinggi.`

Assistant: `Tugas sudah ditambahkan dengan prioritas High.`

### List tasks

User: `Apa tugas saya?`

Assistant returns active tasks in concise numbered form, prioritizing High then Medium then Low.

### Memory

User: `Ingat bahwa topik utama proyek ini adalah personal AI WhatsApp.`

Assistant updates or creates the matching Memory entry and confirms it.

### General chat

User: `Menurutmu mana yang harus saya kerjakan dulu?`

Worker loads a compact list of active tasks plus relevant Memory entries, then asks Gemini for a response.

## 8. Security and privacy

Secrets are stored as Cloudflare Worker secrets, never committed:

- `META_ACCESS_TOKEN`
- `META_APP_SECRET`
- `META_VERIFY_TOKEN`
- `META_PHONE_NUMBER_ID`
- `ALLOWED_WHATSAPP_NUMBER`
- `GEMINI_API_KEY`
- `NOTION_API_KEY`
- `NOTION_INBOX_DATA_SOURCE_ID`
- `NOTION_TASKS_DATA_SOURCE_ID`
- `NOTION_MEMORY_DATA_SOURCE_ID`

Additional controls:

- Verify Meta webhook signatures.
- Reject messages from non-allowlisted senders.
- Do not log access tokens, API keys, full webhook payloads, or full Notion content.
- Store only WhatsApp message IDs in KV for deduplication.
- Keep error replies generic; detailed errors remain in Worker logs.

Privacy caveat: Gemini Developer API Free Tier may use submitted content to improve Google's products according to its current pricing/data-use notice. V1 should therefore not be used for passwords, financial credentials, highly confidential documents, or other secrets. The AI provider can later be swapped without changing WhatsApp or Notion architecture.

## 9. Error handling

### Meta send failure

Log status code and request ID without secrets. Do not retry indefinitely. One short retry is acceptable only for transient 5xx/429 responses.

### Gemini unavailable/quota exceeded

Deterministic Notion commands continue to work. For chat or ambiguous requests, reply that the AI service is temporarily unavailable and ask the user to retry later.

### Notion failure

Do not state that data was saved. Reply with a concise failure message and retain no false local copy in V1.

### Duplicate webhook

Return success and do nothing if the message ID is already present in KV.

### Unsupported WhatsApp media

Reply once: `V1 saat ini hanya mendukung pesan teks.`

## 10. Cost boundary

V1 is designed to stay within free tiers for personal usage:

- Meta test number: development/test sender, up to five approved recipients.
- Cloudflare Workers Free: suitable for the expected request volume.
- Cloudflare KV Free: sufficient for personal message-ID deduplication.
- Gemini: use a Free Tier eligible model and keep model configurable.
- Notion: personal workspace plus API integration.

No paid VPS, dedicated PC, GPU, or local server is required.

A later move from Meta's test number to a permanent production WhatsApp number is a separate phase and may introduce Meta messaging charges or additional business setup requirements.

## 11. Project structure

```text
personal-ai-whatsapp/
  src/
    index.ts
    config.ts
    security.ts
    whatsapp.ts
    router.ts
    parser.ts
    gemini.ts
    notion.ts
    types.ts
  test/
    parser.test.ts
    webhook.test.ts
    router.test.ts
  wrangler.jsonc
  package.json
  tsconfig.json
  README.md
  docs/
    superpowers/specs/
      2026-08-30-whatsapp-personal-assistant-v1-design.md
```

## 12. Test strategy

Before calling V1 complete:

1. Unit-test deterministic intent parsing.
2. Test valid and invalid webhook verification.
3. Test signature rejection.
4. Test sender allowlist rejection.
5. Test duplicate message handling.
6. Test `ADD_NOTE` against a mocked Notion API.
7. Test `ADD_TASK` and `LIST_TASKS` against mocked Notion API.
8. Test `REMEMBER` and `RECALL` against mocked Notion API.
9. Test Gemini structured-output parsing and malformed output fallback.
10. Deploy to Cloudflare and complete a real WhatsApp smoke test using the Meta test number.
11. Confirm a real note appears in Inbox.
12. Confirm a real task appears in Tasks and can be listed back through WhatsApp.
13. Confirm a real Memory entry can be stored and retrieved.

## 13. V1 acceptance criteria

V1 is accepted only when all of these work from the user's WhatsApp number:

- A normal question receives an AI response.
- `Catat ...` creates a correct Inbox record.
- `Tambah tugas ...` creates a correct Tasks record.
- `Apa tugas saya?` reads active tasks from Notion.
- `Ingat bahwa ...` creates or updates a Memory record.
- A duplicate webhook cannot create duplicate Notion records.
- Messages from another phone number are rejected.
- No secret is stored in the repository.

## 14. Deferred features

Not part of V1:

- Google Calendar/reminders
- web search/research agent
- PDF/document reading
- voice notes/audio transcription
- images
- WhatsApp groups
- multiple users
- autonomous background jobs
- long-term chat transcript storage
- n8n
- permanent production WhatsApp number
