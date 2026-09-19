# Memory 2.0 — Structured Memory + Confirm-to-Write

## Goal
Upgrade Youyou Memory from flat key/value facts into structured Identity / Preference / Goal / Project / Pattern categories, with hybrid write policy: explicit remember → write immediately; inferred facts → propose then confirm (`ya` / `jangan`).

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Schema | **A** — satu DB Memory Notion; perluas Category |
| Write policy | **C** — hybrid usul + konfirmasi |
| Implementasi | **C** Hybrid — prompt + kode gate (mirip Brain v1 delete confirm) |
| Deploy | Worker only |

## Categories

| Category | Purpose | Write rule |
|----------|---------|------------|
| `Identity` | nama, kuliah, kampus, identitas stabil | eksplisit langsung; inferred → confirm |
| `Preference` | gaya jawaban, bahasa, cara belajar | sama |
| `Goal` | target jangka panjang | sama |
| `Project` | proyek aktif (Werkudhara, Youyou, …) | sama |
| `Pattern` | pola perilaku | **selalu** propose + confirm; jangan label permanen tanpa ya |
| `Other` | sisanya | sama seperti Identity |
| `Profile` (legacy) | baris lama | **baca saja**; tulis baru pakai `Identity` |

### Notion (manual, sekali)
Di property Category DB Memory, pastikan opsi select: `Identity`, `Preference`, `Goal`, `Project`, `Pattern`, `Other`. Biarkan `Profile` tetap ada untuk baris lama.

## Write policy (detail)

1. **Eksplisit** — user text matches remember/save intent (e.g. `ingat bahwa`, `ingat ya`, `simpan preferensi`, `catat di memori`) → `create_notion_memory` / upsert **langsung**.
2. **Inferred** — model emits `create_notion_memory` without explicit signal → **jangan** upsert; save `pending_memory` in KV; reply propose text.
3. **Pattern** — even if model tries direct write, treat as inferred (always confirm) unless user explicitly asked to save that pattern.
4. **Confirm** — pending fresh (≤10 min): `ya` → upsert + clear; `jangan` → clear; stale → clear and fall through to Gemini.
5. **Conflict** — if both `pending_delete` and `pending_memory` exist, **delete confirm wins** (handle first).

## Architecture

```
WhatsApp → Bridge → Worker router
                      │
         ┌────────────┴────────────┐
         │ Gemini (Memory 2.0 rules│
         │ + grouped memory context)│
         └────────────┬────────────┘
                      │
         ┌────────────┴────────────┐
         │ Action Safety (kode)    │
         │ - userExplicitRemember  │
         │ - pending_memory KV     │
         │ - confirm short-circuit │
         └────────────┬────────────┘
                      │
                   Notion Memory
```

## Pending memory shape
```ts
type PendingMemory = {
  key: string;
  value: string;
  category: MemoryCategory; // Identity | Preference | Goal | Project | Pattern | Other
  createdAt: number;
};
```
KV key: `pending_memory:${userId}`, TTL 3600s; freshness gate 10 minutes (reuse Brain v1 pattern).

## Prompt rules (gemini.ts)
- Classify memory into the new categories; prefer stable keys (`universitas`, `gaya_jawaban`, …).
- Inject context **grouped by category** (Identity first, then Preference, Goal, Project, Pattern, Other); keep a reasonable cap (e.g. ≤12 total lines).
- Infer interesting facts → propose in text OR emit create tool (code will hold if not explicit).
- Pattern: propose only; never claim permanent labels without confirmation.
- Explicit remember → call `create_notion_memory` immediately.

## Files
| File | Change |
|------|--------|
| `src/types.ts` | Expand `MemoryCategory`; keep Profile readable if needed via union or map |
| `src/gemini.ts` | Memory 2.0 rules; tool enum; grouped context |
| `src/action-safety.ts` | `userExplicitRemember`, helpers for memory propose gate |
| `src/state.ts` | get/save/clear pending memory; clearMemory clears it |
| `src/router.ts` | gate create_notion_memory; confirm short-circuit (after delete confirm) |
| `src/notion.ts` | accept new categories; map legacy Profile on read for display if useful |
| `test/*` | explicit write; inferred→propose; ya/jangan; Pattern force confirm |

## Non-goals
- New Goals/Projects Notion databases
- Full Context Manager
- Automatic permanent personality labeling without confirm
- Bridge / Termux changes

## Success criteria
1. “Ingat bahwa kuliah saya di UNY” → Identity row written immediately.
2. Inferred fact without perintah → propose; `ya` writes; `jangan` does not.
3. Pattern never auto-writes without confirm.
4. Chat prompt still sees relevant Identity/Preference/Goal groups.
5. Existing Brain v1 delete confirm and task Notes/deadline behavior unchanged.

## Testing
Unit tests with mocked Notion + KV. Manual DM after `wrangler deploy`.

## Deploy
`npx wrangler deploy` Worker only.
