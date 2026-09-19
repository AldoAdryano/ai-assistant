# Context Manager v1 — Topic State + Anti-Stickiness

## Goal
Youyou tracks **current** vs **previous** conversation topic so replies do not keep nagging or dwelling on an old task/topic after Aldo switches (e.g. drone → belanja kaos).

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Depth | **C** Hybrid — KV topic state + prompt rules |
| Detection | **C** Hybrid — explicit phrases in code + Gemini tool `set_conversation_topic` |
| Scope chat | **DM only** — Context Manager v1 tidak jalan di grup WhatsApp (grup tetap ringan; topic-per-grup = fitur terpisah nanti) |
| Deploy | Worker only |

## State (KV)
Key: `conversation_context:${userId}`  
TTL: 7 days (aligned with chat log), refreshed on each write.

```ts
type ConversationContext = {
  currentTopic: string;
  previousTopic: string | null;
  activeTaskHint: string | null; // optional short title/id
  updatedAt: number;
};
```

On topic switch: `previousTopic = currentTopic`, then set new `currentTopic`. Old topic is retained as previous, not deleted.

## Detection

### 1. Explicit phrases (code, before or alongside Gemini)
Patterns (Indonesian, case-insensitive), e.g.:
- `pindah topik`, `ganti topik`, `topik baru`, `kita bahas yang lain`, `bahas yang lain`

If matched: extract remainder as topic label when present; else set a short placeholder and let Gemini refine via tool. Call `applyTopicSwitch`.

### 2. Gemini tool `set_conversation_topic`
- Args: `topic` (string, required), `reason` (optional)
- Use when model is confident the **subject** changed (not the same task getting a deadline clarification like “besok”)
- Router persists via same `applyTopicSwitch` helper

### 3. Do **not** switch on
- Pure deadline/time replies for an in-flight task (“besok”, “jam 8”)
- Confirm ya/jangan for delete/memory pending
- Short acknowledgements that continue the same thread

## Prompt injection (DM)
Always include in system/context for Gemini:
```
CURRENT TOPIC: …
PREVIOUS TOPIC: … | none
```
Rules:
- Prefer answering in **current** topic.
- Mention previous only if Aldo brings it back or it is clearly needed.
- Do not nag unfinished tasks from previous topic unless asked or user returns to that topic.

## Architecture
```
Message → Router
  ├─ explicit phrase? → update KV
  ├─ load ConversationContext → Gemini (inject topics + tool)
  └─ set_conversation_topic tool? → update KV
```

## Files
| File | Change |
|------|--------|
| `src/conversation-context.ts` | types, phrase detect, `applyTopicSwitch` |
| `src/state.ts` | get/save conversation context |
| `src/gemini.ts` | inject topics; tool `set_conversation_topic`; anti-stickiness rules |
| `src/router.ts` | wire detect + tool; pass context into generateChatReply |
| `test/*` | phrase switch, no-switch on “besok”, tool handler, context formatting |

## Non-goals
- Multi-topic stack / nested contexts
- Auto-link to Notion Projects DB
- Full Context Manager in WhatsApp groups (groups stay light)
- Proactive briefing (Task Intelligence — later)

## Success criteria
1. After drone talk, user says buy kaos / “pindah topik belanja” → reply focuses on shopping, does not nag drone task.
2. KV shows previous ≈ drone, current ≈ shopping.
3. Deadline clarification (“besok”) on same task → topic unchanged.
4. Brain v1 + Memory 2.0 confirm flows unchanged.

## Testing
Unit tests with mocked KV. Manual DM after `wrangler deploy`.

## Deploy
`npx wrangler deploy` Worker only.
