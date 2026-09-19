# Task Intelligence v1 — Selective Briefing + On-Demand

## Goal
Youyou delivers **useful, polite task briefings** on a schedule and on request, without flooding Aldo with every Notion task or mixing “jangan lupa” into ordinary chat (Context Manager anti-nag stays).

## Decisions (approved)
| Keputusan | Pilihan |
|-----------|---------|
| Bentuk | **B** — slot terjadwal 07 & 18 WIB **+** on-demand di DM |
| Konflik dengan chat aktif | **A** — tetap kirim briefing terjadwal sebagai pesan terpisah (tidak nyampur ke balasan chat) |
| Seleksi tugas | **B** — overdue + due hari ini + due ≤24 jam + High tanpa due (cap ~8) |
| Implementasi | Upgrade cron/alarm yang ada + helper seleksi + frase DM; bedakan nada briefing vs urgent |
| Scope chat | **DM only** untuk on-demand; cron → antrean alarm bridge (seperti sekarang) |
| Deploy | Worker only |

## Modes

| Mode | Trigger | Task set | Tone |
|------|---------|----------|------|
| **Briefing** | Cron first tick of 07:00 & 18:00 WIB; DM phrases | Filter B (below) | Ringkas, sopan, terstruktur — Youyou cerewet tapi bukan omel random |
| **Urgent** | Cron `*/10` when datetime due is within ≤60 minutes | Only those mepet tasks | Tegas / mepet (keep current urgent behavior) |

### Filter B (briefing selection)
From active Notion tasks, include (dedupe by id), then cap at **8** (prefer overdue → due soon → High no-due):

1. **Overdue** — due date/time strictly before now (WIB)
2. **Due today** — due calendar day = today WIB (date-only or datetime)
3. **Due within 24 hours** — datetime due in (0, 24h] from now
4. **High without due** — priority High and no `due`

Date-only tasks with due > today are **not** in briefing unless they fall in (1)–(2).  
Urgent mode does **not** use the full Filter B list — only ≤60 min datetime tasks.

### Anti-double at 07/18
- One **briefing** message per daily slot (07 and 18).
- If the same tick also has urgent mepet tasks: **one** outbound message — urgent tasks first, then any remaining Filter B items not already listed.
- Outside 07/18, urgent-only messages continue as today.

## On-demand (DM)
Explicit phrases (case-insensitive), e.g.:
- `briefing`, `ringkasin tugas`, `ringkas tugas`
- `apa tugas saya`, `daftar tugas hari ini`, `tugas hari ini`

Behavior:
1. Load active tasks from Notion (same as chat context).
2. Apply Filter B.
3. Generate briefing via dedicated prompt helper (same tone rules as scheduled briefing).
4. Reply **inline** in the DM turn (do not require `pending_alarms` queue).

If Filter B empty → short “aman / tidak ada yang mepet” Youyou reply (no fake tasks).

**Groups:** ignore these phrases for Task Intelligence v1 (no change to group routing).

## Prompt / generation
- Shared helper e.g. `selectBriefingTasks(tasks, nowMs) → TaskRecord[]`
- `generateTaskBriefing(...)` for briefing tone (scheduled + on-demand)
- Keep `generateProactiveAlarm` for **urgent** mepet (or thin wrapper that picks tone by mode)
- Briefing rules: structured short list; natural time language; no inventing tasks; still Youyou persona; do not claim user “just asked” on cron path

## Architecture
```
Cron */10
  ├─ 07/18 slot? → Filter B → generateTaskBriefing → queueAlarm
  └─ datetime ≤60m? → urgent set → generateProactiveAlarm → queueAlarm
       (same tick: merge into one outbound message when both fire)

DM message
  └─ briefing phrase? → Filter B → generateTaskBriefing → reply
  └─ else → existing router (Brain / Memory / Context unchanged)
```

## Files (expected)
| File | Change |
|------|--------|
| `src/task-intelligence.ts` (new) | `selectBriefingTasks`, phrase detect, maybe merge helper |
| `src/index.ts` | cron uses Filter B + briefing vs urgent |
| `src/gemini.ts` | `generateTaskBriefing`; keep urgent alarm path |
| `src/router.ts` | on-demand phrase → briefing reply early |
| `test/task-intelligence.test.ts` | filter edge cases, phrases |
| `test/cron.test.ts` / `test/router.test.ts` | wire scheduled + DM |

## Non-goals
- Defer briefing because user is mid-chat
- Goals / Projects DB linking
- Weekly review / planning sessions
- Changing 07/18 slot hours
- Group on-demand briefing
- Softening Context Manager anti-nag inside ordinary chat replies

## Success criteria
1. At 07/18 WIB tick, Aldo gets one selective briefing (Filter B), not the entire task dump when many tasks exist.
2. DM `briefing` / `ringkasin tugas` returns the same style of summary immediately.
3. Datetime due ≤60 minutes still gets urgent-style reminders every ~10 minutes.
4. Mid-chat recipe/shopping replies still do **not** unsolicited-nag Notion tasks (Context Manager rules unchanged).
5. Empty Filter B → calm “nothing urgent” message, not silence without explanation on on-demand.

## Testing
Unit tests for selection (overdue, today, 24h, High no-due, cap 8, empty).  
Router phrase → briefing.  
Cron slot uses briefing path (mocked time).  
Manual DM after `wrangler deploy`.

## Deploy
`npx wrangler deploy` Worker only.
