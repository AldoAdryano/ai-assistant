# Task Intelligence v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selective Filter-B task briefings at 07/18 WIB and on DM request, while keeping urgent ≤60-minute alarms separate and Context Manager anti-nag unchanged.

**Architecture:** Pure selection/phrase helpers in `task-intelligence.ts`; `generateTaskBriefing` in `gemini.ts` for polite tone; `runScheduled` in `index.ts` splits briefing vs urgent (merge one message on same tick); router short-circuits DM briefing phrases before Gemini chat.

**Tech Stack:** Cloudflare Worker TypeScript, Vitest, Notion task list, Gemini `generateContent`, existing `pending_alarms` KV queue.

**Spec:** `docs/superpowers/specs/2026-09-19-youyou-task-intelligence-v1-design.md`

## Global Constraints
- **DM only** for on-demand briefing phrases; groups unchanged.
- Filter B: overdue + due today + due ≤24h (datetime) + High without due; **cap 8**; order overdue → due-soon → High no-due.
- Cron 07/18 = briefing path; datetime ≤60m = urgent path; same tick → **one** message (urgent first).
- Do not regress Brain / Memory / Context Manager chat anti-nag.
- Deploy: Worker only (`npx wrangler deploy`).
- Date math uses WIB via `getJakartaDateParts` from `src/date.ts`.

## File map
| File | Responsibility |
|------|----------------|
| `src/task-intelligence.ts` | `selectBriefingTasks`, `selectUrgentTasks`, `mergeAlarmTaskLists`, `detectBriefingRequest`, `isDailyReminderSlot`, empty-copy helper |
| `src/gemini.ts` | `generateTaskBriefing` |
| `src/index.ts` | Cron uses helpers + briefing/urgent generators |
| `src/router.ts` | Early DM briefing reply |
| `test/task-intelligence.test.ts` | Filter + phrases |
| `test/cron.test.ts` | Scheduled briefing vs urgent |
| `test/router.test.ts` | On-demand DM |
| `test/gemini.test.ts` | Optional light prompt assertion for briefing |

---

### Task 1: Pure task-intelligence helpers (TDD)

**Files:**
- Create: `src/task-intelligence.ts`
- Create: `test/task-intelligence.test.ts`

**Interfaces:**
```ts
import type { TaskRecord } from "./types";

export const BRIEFING_CAP = 8;

/** First 10-minute cron tick of 07:00 or 18:00 WIB. */
export function isDailyReminderSlot(hourWib: number, minuteWib: number): boolean;

/** Filter B — selective briefing list (deduped, capped). */
export function selectBriefingTasks(tasks: TaskRecord[], nowMs: number): TaskRecord[];

/** Datetime due in (0, 60] minutes from nowMs. */
export function selectUrgentTasks(tasks: TaskRecord[], nowMs: number): TaskRecord[];

/** Urgent first, then briefing items whose id not already in urgent. */
export function mergeAlarmTaskLists(urgent: TaskRecord[], briefing: TaskRecord[]): TaskRecord[];

/** DM phrase detect; null if not a briefing request. */
export function detectBriefingRequest(userText: string): boolean;

/** Fixed empty on-demand copy (Youyou tone, no Gemini required). */
export function emptyBriefingReply(): string;
```

**Due parsing rules (implement exactly):**
- `due` missing → only eligible via High-without-due bucket if `priority === "High"`.
- Date-only (`!due.includes("T")`):
  - Compare `due` string (`YYYY-MM-DD`) to today WIB `YYYY-MM-DD` from `getJakartaDateParts(new Date(nowMs))`.
  - Overdue: `due < today`.
  - Due today: `due === today`.
  - **Not** placed in “within 24h” solely for being tomorrow (spec: date-only `due > today` excluded unless overdue/today).
- Datetime (`due` has `T`):
  - `dueMs = new Date(due).getTime()`.
  - Overdue: `dueMs < nowMs`.
  - Due today: Jakarta Y-M-D of `dueMs` equals today WIB.
  - Within 24h: `diffMs = dueMs - nowMs` and `0 < diffMs <= 24 * 60 * 60 * 1000`.
- Urgent: datetime only, `0 < dueMs - nowMs <= 60 * 60 * 1000`.

**Ordering before cap:**
1. All overdue (sort by due ascending; undated last N/A).
2. Then due-today / within-24h not already included (sort by due ascending; date-only today before later datetimes when equal day).
3. Then High without due (stable by title).
4. Slice to `BRIEFING_CAP`.

**Phrases for `detectBriefingRequest`** (case-insensitive, trim; match if text equals or is short message containing):
- whole-message or dominant intent regexes covering: `briefing`, `ringkasin tugas`, `ringkas tugas`, `apa tugas saya`, `daftar tugas hari ini`, `tugas hari ini`
- Reject if clearly not a request (e.g. long paragraph that only mentions “tugas” mid-sentence) — prefer: return true when normalized text matches `/^(briefing|ringkasin?\s+tugas|ringkas\s+tugas|apa\s+tugas\s+saya|daftar\s+tugas(\s+hari\s+ini)?|tugas\s+hari\s+ini)\??[!.,]*$/i` after collapsing whitespace.

**`emptyBriefingReply`:** fixed string, e.g.  
`Hmph. Untuk sekarang sih lagi sepi, Tuan Muda — tidak ada yang overdue, due hari ini, atau mepet 24 jam. Santai dulu, jangan malah bikin tugas fiktif! 😌`

- [ ] **Step 1: Write failing tests** in `test/task-intelligence.test.ts`

```ts
import { describe, it, expect } from "vitest";
import {
  selectBriefingTasks,
  selectUrgentTasks,
  mergeAlarmTaskLists,
  detectBriefingRequest,
  isDailyReminderSlot,
  BRIEFING_CAP,
} from "../src/task-intelligence";
import type { TaskRecord } from "../src/types";

function task(partial: Partial<TaskRecord> & { id: string; task: string }): TaskRecord {
  return { status: "To Do", priority: "Medium", ...partial };
}

describe("isDailyReminderSlot", () => {
  it("true at 07:00–07:09 and 18:00–18:09", () => {
    expect(isDailyReminderSlot(7, 0)).toBe(true);
    expect(isDailyReminderSlot(7, 9)).toBe(true);
    expect(isDailyReminderSlot(18, 5)).toBe(true);
    expect(isDailyReminderSlot(7, 10)).toBe(false);
    expect(isDailyReminderSlot(12, 0)).toBe(false);
  });
});

describe("selectBriefingTasks", () => {
  // Fixed instant: 2026-09-02 10:00 WIB = 03:00 UTC
  const nowMs = Date.parse("2026-09-02T03:00:00Z");

  it("includes overdue date-only, due today, datetime within 24h, High no due", () => {
    const selected = selectBriefingTasks([
      task({ id: "old", task: "Overdue", due: "2026-09-01", priority: "Low" }),
      task({ id: "today", task: "Hari ini", due: "2026-09-02", priority: "Medium" }),
      task({ id: "soon", task: "Malam ini", due: "2026-09-02T15:00:00Z", priority: "Medium" }),
      task({ id: "hi", task: "High undated", priority: "High" }),
      task({ id: "later", task: "Besok date-only", due: "2026-09-03", priority: "High" }),
      task({ id: "far", task: "Far datetime", due: "2026-09-05T03:00:00Z", priority: "High" }),
      task({ id: "med", task: "Medium undated", priority: "Medium" }),
    ], nowMs);
    const ids = selected.map((t) => t.id);
    expect(ids).toContain("old");
    expect(ids).toContain("today");
    expect(ids).toContain("soon");
    expect(ids).toContain("hi");
    expect(ids).not.toContain("later");
    expect(ids).not.toContain("far");
    expect(ids).not.toContain("med");
  });

  it("caps at BRIEFING_CAP preferring overdue first", () => {
    const many: TaskRecord[] = [];
    for (let i = 0; i < 10; i++) {
      many.push(task({ id: `o${i}`, task: `Old ${i}`, due: "2026-08-01", priority: "Low" }));
    }
    for (let i = 0; i < 5; i++) {
      many.push(task({ id: `h${i}`, task: `High ${i}`, priority: "High" }));
    }
    const selected = selectBriefingTasks(many, nowMs);
    expect(selected).toHaveLength(BRIEFING_CAP);
    expect(selected.every((t) => t.id.startsWith("o"))).toBe(true);
  });

  it("returns empty when nothing matches", () => {
    expect(selectBriefingTasks([
      task({ id: "1", task: "Later", due: "2026-09-10", priority: "Medium" }),
    ], nowMs)).toEqual([]);
  });
});

describe("selectUrgentTasks", () => {
  const nowMs = Date.parse("2026-09-02T10:00:00Z");
  it("only datetime within 60 minutes", () => {
    const selected = selectUrgentTasks([
      task({ id: "u", task: "Mepet", due: "2026-09-02T10:45:00Z", priority: "High" }),
      task({ id: "d", task: "Date only today", due: "2026-09-02", priority: "High" }),
      task({ id: "f", task: "Far", due: "2026-09-02T12:00:00Z", priority: "High" }),
    ], nowMs);
    expect(selected.map((t) => t.id)).toEqual(["u"]);
  });
});

describe("mergeAlarmTaskLists", () => {
  it("urgent first then briefing without dup ids", () => {
    const u = [task({ id: "a", task: "A", due: "2026-09-02T10:30:00Z" })];
    const b = [
      task({ id: "a", task: "A", due: "2026-09-02T10:30:00Z" }),
      task({ id: "b", task: "B", due: "2026-09-01" }),
    ];
    expect(mergeAlarmTaskLists(u, b).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("detectBriefingRequest", () => {
  it("matches known phrases", () => {
    expect(detectBriefingRequest("briefing")).toBe(true);
    expect(detectBriefingRequest("Ringkasin tugas")).toBe(true);
    expect(detectBriefingRequest("apa tugas saya?")).toBe(true);
    expect(detectBriefingRequest("tugas hari ini")).toBe(true);
  });
  it("rejects unrelated chat", () => {
    expect(detectBriefingRequest("resep ayam goreng")).toBe(false);
    expect(detectBriefingRequest("besok")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/task-intelligence.test.ts`  
Expected: FAIL (module not found / exports missing)

- [ ] **Step 3: Write minimal implementation** in `src/task-intelligence.ts`

```ts
import type { TaskRecord } from "./types";
import { getJakartaDateParts } from "./date";

export const BRIEFING_CAP = 8;

export function isDailyReminderSlot(hourWib: number, minuteWib: number): boolean {
  return (hourWib === 7 || hourWib === 18) && minuteWib < 10;
}

function todayWibYmd(nowMs: number): string {
  const { year, month, day } = getJakartaDateParts(new Date(nowMs));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function ymdFromDueMs(dueMs: number): string {
  const { year, month, day } = getJakartaDateParts(new Date(dueMs));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dueSortKey(t: TaskRecord): number {
  if (!t.due) return Number.POSITIVE_INFINITY;
  if (!t.due.includes("T")) return Date.parse(t.due + "T00:00:00+07:00");
  return Date.parse(t.due);
}

export function selectBriefingTasks(tasks: TaskRecord[], nowMs: number): TaskRecord[] {
  const today = todayWibYmd(nowMs);
  const dayMs = 24 * 60 * 60 * 1000;
  const overdue: TaskRecord[] = [];
  const soon: TaskRecord[] = [];
  const highNoDue: TaskRecord[] = [];
  const seen = new Set<string>();

  for (const t of tasks) {
    if (seen.has(t.id)) continue;
    if (!t.due) {
      if (t.priority === "High") {
        highNoDue.push(t);
        seen.add(t.id);
      }
      continue;
    }
    if (!t.due.includes("T")) {
      if (t.due < today) {
        overdue.push(t); seen.add(t.id);
      } else if (t.due === today) {
        soon.push(t); seen.add(t.id);
      }
      continue;
    }
    const dueMs = Date.parse(t.due);
    if (Number.isNaN(dueMs)) continue;
    if (dueMs < nowMs) {
      overdue.push(t); seen.add(t.id);
    } else {
      const in24h = dueMs - nowMs > 0 && dueMs - nowMs <= dayMs;
      const dueToday = ymdFromDueMs(dueMs) === today;
      if (dueToday || in24h) {
        soon.push(t); seen.add(t.id);
      }
    }
  }

  overdue.sort((a, b) => dueSortKey(a) - dueSortKey(b));
  soon.sort((a, b) => dueSortKey(a) - dueSortKey(b));
  highNoDue.sort((a, b) => a.task.localeCompare(b.task));
  return [...overdue, ...soon, ...highNoDue].slice(0, BRIEFING_CAP);
}

export function selectUrgentTasks(tasks: TaskRecord[], nowMs: number): TaskRecord[] {
  const hourMs = 60 * 60 * 1000;
  return tasks.filter((t) => {
    if (!t.due || !t.due.includes("T")) return false;
    const dueMs = Date.parse(t.due);
    if (Number.isNaN(dueMs)) return false;
    const diff = dueMs - nowMs;
    return diff > 0 && diff <= hourMs;
  }).sort((a, b) => dueSortKey(a) - dueSortKey(b));
}

export function mergeAlarmTaskLists(urgent: TaskRecord[], briefing: TaskRecord[]): TaskRecord[] {
  const ids = new Set(urgent.map((t) => t.id));
  return [...urgent, ...briefing.filter((t) => !ids.has(t.id))];
}

export function detectBriefingRequest(userText: string): boolean {
  const n = userText.toLowerCase().replace(/\s+/g, " ").trim();
  return /^(briefing|ringkasin?\s+tugas|ringkas\s+tugas|apa\s+tugas\s+saya|daftar\s+tugas(?:\s+hari\s+ini)?|tugas\s+hari\s+ini)\??[!.,]*$/i.test(n);
}

export function emptyBriefingReply(): string {
  return "Hmph. Untuk sekarang sih lagi sepi, Tuan Muda — tidak ada yang overdue, due hari ini, atau mepet 24 jam. Santai dulu, jangan malah bikin tugas fiktif! 😌";
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run test/task-intelligence.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/task-intelligence.ts test/task-intelligence.test.ts
git commit -m "feat: task-intelligence selection and briefing phrases"
```

---

### Task 2: `generateTaskBriefing` (TDD light)

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Interfaces:**
```ts
export async function generateTaskBriefing(
  config: AppConfig,
  tasksForBriefing: TaskRecord[],
  context: { tasks: TaskRecord[]; memories: MemoryRecord[] },
  opts: { source: "cron" | "on_demand" },
  fetchImpl?: typeof fetch,
): Promise<string>;
```

**Behavior:**
- If `tasksForBriefing.length === 0`, return `emptyBriefingReply()` from `task-intelligence` (no API call).
- Else call Gemini like `generateProactiveAlarm`, but system rules:
  - Persona Youyou
  - This is a **briefing** (ringkas, terstruktur, sopan-cerewet), not random omel
  - List only supplied tasks; do not invent
  - Natural time language; avoid saying year / “prioritas”
  - If `source === "cron"`: user did not message you; do not say they asked
  - If `source === "on_demand"`: they asked for a briefing; answer that request
- Keep `generateProactiveAlarm` for urgent tone unchanged.

- [ ] **Step 1: Add test** that empty list does not call fetch and returns empty copy; non-empty builds prompt containing `BRIEFING` or `briefing` marker and task title.

```ts
import { generateTaskBriefing } from "../src/gemini";
import { emptyBriefingReply } from "../src/task-intelligence";

it("generateTaskBriefing returns empty copy without fetch", async () => {
  const fetchImpl = vi.fn();
  const text = await generateTaskBriefing(
    config,
    [],
    { tasks: [], memories: [] },
    { source: "on_demand" },
    fetchImpl as any,
  );
  expect(text).toBe(emptyBriefingReply());
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("generateTaskBriefing sends briefing prompt for cron", async () => {
  let body: any;
  const fetchImpl = async (_u: any, init: any) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Briefing test" }] } }],
    }), { status: 200 });
  };
  const text = await generateTaskBriefing(
    config,
    [{ id: "1", task: "Perpanjang XL", status: "To Do", priority: "High", due: "2026-09-01" }],
    { tasks: [], memories: [] },
    { source: "cron" },
    fetchImpl as any,
  );
  expect(text).toContain("Briefing");
  const sys = body.systemInstruction.parts[0].text;
  expect(sys.toLowerCase()).toMatch(/briefing/);
  expect(sys).toContain("Perpanjang XL");
  expect(sys).toMatch(/TIDAK mengirim|berinisiatif|Cron/i);
});
```

- [ ] **Step 2: Implement `generateTaskBriefing`** next to `generateProactiveAlarm` in `src/gemini.ts` (mirror fetch/error fallback pattern; fallback string may list task titles).

- [ ] **Step 3: Tests PASS** — `npx vitest run test/gemini.test.ts`

- [ ] **Step 4: Commit** — `feat: add generateTaskBriefing for Task Intelligence`

---

### Task 3: Wire cron in `index.ts` (TDD)

**Files:**
- Modify: `src/index.ts`
- Modify: `test/cron.test.ts`

**Interfaces / deps:**
- Extend `WorkerDeps` with `generateTaskBriefing: typeof generateTaskBriefing`
- Import `isDailyReminderSlot`, `selectBriefingTasks`, `selectUrgentTasks`, `mergeAlarmTaskLists` from `./task-intelligence`
- Remove local duplicate `isDailyReminderSlot` from `index.ts`

**`runScheduled` task-alarm logic (replace the current for-loop selection):**

```ts
const nowMs = Date.now();
const nowWib = new Date(nowMs + 7 * 60 * 60 * 1000);
const currentHour = nowWib.getUTCHours();
const currentMinute = nowWib.getUTCMinutes();
const dailySlot = isDailyReminderSlot(currentHour, currentMinute);

const urgent = selectUrgentTasks(tasks, nowMs);
const briefing = dailySlot ? selectBriefingTasks(tasks, nowMs) : [];

if (urgent.length > 0 && briefing.length > 0) {
  const merged = mergeAlarmTaskLists(urgent, briefing);
  // One message: use briefing generator but prepend instruction that urgent items come first —
  // OR: generateProactiveAlarm(urgent) + "\n\n" + generateTaskBriefing(remainder).
  // REQUIRED behavior from spec: one outbound queueAlarm message.
  // Implement: 
  const remainder = mergeAlarmTaskLists([], briefing.filter(t => !urgent.some(u => u.id === t.id)));
  // simpler:
  const remainder = briefing.filter((t) => !urgent.some((u) => u.id === t.id));
  const urgentMsg = await deps.generateProactiveAlarm(config, urgent, { tasks, memories });
  const briefMsg = remainder.length
    ? await deps.generateTaskBriefing(config, remainder, { tasks, memories }, { source: "cron" })
    : "";
  await queueAlarm(env, briefMsg ? `${urgentMsg}\n\n${briefMsg}` : urgentMsg);
} else if (urgent.length > 0) {
  await queueAlarm(env, await deps.generateProactiveAlarm(config, urgent, { tasks, memories }));
} else if (briefing.length > 0) {
  await queueAlarm(env, await deps.generateTaskBriefing(config, briefing, { tasks, memories }, { source: "cron" }));
}
// if both empty: no task alarm (routines unchanged below)
```

Note: `merged` variable unused in snippet — do not leave dead code; use the `remainder` approach above.

**Test updates (`test/cron.test.ts`):**
1. Add `generateTaskBriefing: vi.fn().mockResolvedValue("Briefing!")` to `mockDeps` / `beforeEach`.
2. Change expectations for **07:00 / 18:00 date-only today** cases: expect `generateTaskBriefing` called (not `generateProactiveAlarm`), with the today task.
3. Keep **urgent ≤60m non-slot** expecting `generateProactiveAlarm` only; `generateTaskBriefing` not called.
4. Add case: 07:00 with overdue + urgent mepet → both generators called once; `DEDUP_KV.put` for `pending_alarms` once (or get+put pattern once with combined string).
5. Add case: 07:00 with only far future Medium task → neither generator called.
6. Add case: 07:00 with High no-due → `generateTaskBriefing` called.

- [ ] Failing tests → implement → PASS  
- [ ] Commit: `feat: cron selective briefing vs urgent alarms`

---

### Task 4: Router on-demand briefing (TDD)

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Interfaces:**
- Extend `RouterDeps` with `generateTaskBriefing: typeof generateTaskBriefing`
- Import `detectBriefingRequest`, `selectBriefingTasks`, `emptyBriefingReply` from `./task-intelligence`

**Placement:** After pending delete/memory handling, **before** topic-switch / Gemini — only when `!isGroup`:

```ts
if (!isGroup && detectBriefingRequest(normalizedText)) {
  const tasks = await deps.listActiveTasks(config);
  const memories = await deps.listMemoryContext(config);
  const selected = selectBriefingTasks(tasks, Date.now());
  if (selected.length === 0) return emptyBriefingReply();
  return deps.generateTaskBriefing(config, selected, { tasks, memories }, { source: "on_demand" });
}
```

Also append to chat log optionally (YAGNI: skip log update for v1 **or** mirror other early returns — prefer: still `append` user+assistant if easy; if other early returns skip log, match that pattern).

**Tests:**
1. DM text `briefing` → `generateTaskBriefing` called with Filter-B subset; Gemini chat `generateChatReply` **not** called.
2. Empty Filter B → returns `emptyBriefingReply()`; no Gemini.
3. Group + `briefing` → does **not** short-circuit (falls through to group path / no `generateTaskBriefing`).
4. Existing delete/memory confirm tests still pass.

Wire `generateTaskBriefing` into `defaultDeps`.

- [ ] Commit: `feat: DM on-demand task briefing`

---

### Task 5: Verify + deploy

- [ ] `npx vitest run` — all PASS
- [ ] `npx wrangler deploy`
- [ ] Manual DM: `briefing` / `ringkasin tugas`; empty vs with overdue task; chat resep still no nag
- [ ] Optional: wait for next 07/18 or temporarily log path in staging — not required if unit tests cover slot

**Commit** only if leftover doc/test fixes: `chore: Task Intelligence v1 verify`

---

## Spec coverage checklist
| Spec item | Task |
|-----------|------|
| Filter B + cap 8 | Task 1 |
| Phrases on-demand | Task 1 + 4 |
| `generateTaskBriefing` tone + cron/on_demand | Task 2 |
| Cron 07/18 briefing | Task 3 |
| Urgent ≤60m | Task 3 |
| Merge one message same tick | Task 3 |
| Empty on-demand copy | Task 1 + 2 + 4 |
| Groups skip on-demand | Task 4 |
| Context anti-nag untouched | no change to CONVERSATION_TOPIC_RULES |
| Deploy Worker only | Task 5 |
