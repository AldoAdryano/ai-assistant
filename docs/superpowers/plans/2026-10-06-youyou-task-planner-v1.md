# Task Planner v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Youyou menyusun rencana tugas di chat pribadi, menyimpannya di KV, dan baru menulis ke Notion Tasks setelah satu jawaban "ya".

**Architecture:** Modul murni `src/task-plan.ts` memvalidasi operasi dan menyusun teks balasan. `src/state.ts` menyimpan rencana di kunci `pending_task_plan:{userId}`. Gemini hanya menawarkan tool `propose_task_plan` sekali. Router menjalankan daftar operasi yang sudah tersimpan tanpa memanggil Gemini lagi.

**Tech Stack:** TypeScript, Cloudflare Workers, Vitest, Notion API `2026-03-11`, Gemini function calling, KV `DEDUP_KV`.

**Spec:** `docs/superpowers/specs/2026-10-06-youyou-task-planner-v1-design.md`

## Global Constraints

- Chat pribadi saja. Tool planner tidak didaftarkan di grup, dan panggilan yang lolos ditolak.
- Tulisan Notion hanya `createTask` dan `updateTask`. Jangan menulis Goals, Learning, Finance, Inbox, atau Memory.
- Tidak ada loop yang menyusun ulang rencana.
- Kunci KV: `pending_task_plan:{userId}`. Jangan memakai `pending_task:`.
- TTL KV 3600 detik. Router menganggap rencana basi setelah 30 menit dari `createdAt`.
- `due_date` tersimpan `YYYY-MM-DD` kalender WIB.
- Minggu ini: hanya update tugas To Do/Doing, tenggat di dalam `currentWibWeekRange`, tidak membuat tugas, tidak mengubah Done.
- Belajar: hanya create, paling banyak 8, prioritas default `Medium`, judul duplikat tugas aktif dilewati.
- N adalah bilangan terakhir yang berdiri langsung sebelum kata "hari", dan harus 1–90. Angka dari model tidak dipakai.
- Satu jawaban "ya" menjalankan seluruh rencana. "jangan" tidak menulis apa pun.
- Hapus yang masih menunggu konfirmasi didahulukan. Rencana tidak dimulai.
- Selama rencana segar, `create_notion_task` dan `update_notion_task` tidak menulis Notion.
- Tes di host ini lewat Docker karena workerd butuh glibc yang lebih baru:

```bash
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e npm_config_cache=/tmp/.npm -v "$PWD":/app -w /app node:22-bookworm bash -c "npx vitest run test/task-plan.test.ts"
```

Ganti nama file di perintah itu sesuai tugas. Suite penuh di akhir: `bash test-docker.sh`.

Jangan mengubah atau mengembalikan perubahan lokal yang belum di-commit di `src/router.ts`, `src/notion.ts`, `src/date.ts`, `src/gemini.ts`, dan `src/action-safety.ts` selain sisipan yang tugas ini minta.

---

## File map

| File | Tanggung jawab |
|---|---|
| `src/task-plan.ts` | Tipe, parse N, validasi week/learn, format balasan, kesegaran 30 menit. Tanpa Notion dan tanpa KV. |
| `test/task-plan.test.ts` | Tes murni untuk modul di atas. |
| `src/state.ts` | `savePendingTaskPlan`, `getPendingTaskPlan`, `clearPendingTaskPlan`. `clearMemory` juga menghapus kunci ini. |
| `test/pending-task-plan-state.test.ts` | Tes KV. |
| `src/gemini.ts` | Tool `propose_task_plan` di daftar tool DM, plus aturan prompt. |
| `test/gemini.test.ts` | Tool ada di DM, tidak ada di grup. |
| `src/router.ts` | Konfirmasi, tolak tulis tugas saat rencana tertunda, simpan hasil validasi, jalankan operasi. |
| `test/router.test.ts` | Alur ya/jangan, grup, hapus didahulukan, blok create/update. |

---

### Task 1: Tipe, parse N, jendela tanggal, kesegaran

**Files:**
- Create: `src/task-plan.ts`
- Test: `test/task-plan.test.ts`

**Interfaces:**
- Consumes: `getJakartaDateParts`, `formatJakartaDateWithOffset` dari `src/date.ts`
- Produces:
  - `export type PlanPriority = "Low" | "Medium" | "High"`
  - `export type StoredPlanOp`
  - `export type PendingTaskPlan`
  - `export const PENDING_PLAN_FRESH_MS = 30 * 60 * 1000`
  - `export function parseLearningDays(text: string): number | null`
  - `export function learnWindow(now: Date, days: number): { startDate: string; endDate: string }`
  - `export function userMentionsPriority(text: string): boolean`
  - `export function isPendingPlanFresh(plan: PendingTaskPlan, now?: number): boolean`

- [ ] **Step 1: Write the failing test**

Buat `test/task-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PENDING_PLAN_FRESH_MS,
  isPendingPlanFresh,
  learnWindow,
  parseLearningDays,
  userMentionsPriority,
} from "../src/task-plan";

describe("parseLearningDays", () => {
  it("uses the last number directly before hari", () => {
    expect(parseLearningDays("belajar ROS dalam 30 hari")).toBe(30);
    expect(parseLearningDays("belajar MQTT 14 hari")).toBe(14);
    expect(parseLearningDays("belajar 2 jam sehari selama 30 hari")).toBe(30);
  });

  it("returns null when missing or outside 1-90", () => {
    expect(parseLearningDays("belajar ROS")).toBeNull();
    expect(parseLearningDays("belajar ROS 0 hari")).toBeNull();
    expect(parseLearningDays("belajar ROS 91 hari")).toBeNull();
  });
});

describe("learnWindow", () => {
  it("is inclusive from today through today plus N-1 in WIB", () => {
    const now = new Date("2026-10-06T10:00:00+07:00");
    expect(learnWindow(now, 1)).toEqual({ startDate: "2026-10-06", endDate: "2026-10-06" });
    expect(learnWindow(now, 30)).toEqual({ startDate: "2026-10-06", endDate: "2026-11-04" });
  });
});

describe("userMentionsPriority", () => {
  it("matches only the spec priority words", () => {
    expect(userMentionsPriority("atur tugas, prioritas tinggi")).toBe(true);
    expect(userMentionsPriority("priority low please")).toBe(true);
    expect(userMentionsPriority("sedang belajar")).toBe(true);
    expect(userMentionsPriority("atur tugas minggu ini")).toBe(false);
  });
});

describe("isPendingPlanFresh", () => {
  const plan = {
    kind: "week" as const,
    ops: [],
    createdAt: 1_000_000,
  };

  it("is fresh inside 30 minutes and stale after", () => {
    expect(isPendingPlanFresh(plan, plan.createdAt + PENDING_PLAN_FRESH_MS)).toBe(true);
    expect(isPendingPlanFresh(plan, plan.createdAt + PENDING_PLAN_FRESH_MS + 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: perintah Docker di Global Constraints dengan `test/task-plan.test.ts`.

Expected: FAIL, modul `../src/task-plan` tidak ada.

- [ ] **Step 3: Write minimal implementation**

Buat `src/task-plan.ts`:

```ts
import { formatJakartaDateWithOffset, getJakartaDateParts } from "./date";

export type PlanPriority = "Low" | "Medium" | "High";

export type StoredPlanOp =
  | { op: "update"; taskId: string; title: string; due_date: string; priority?: PlanPriority }
  | { op: "create"; title: string; due_date: string; priority: PlanPriority };

export type PendingTaskPlan = {
  kind: "week" | "learn";
  ops: StoredPlanOp[];
  createdAt: number;
};

export const PENDING_PLAN_FRESH_MS = 30 * 60 * 1000;

export function parseLearningDays(text: string): number | null {
  const matches = [...text.toLowerCase().matchAll(/\b(\d+)\s*hari\b/g)];
  if (matches.length === 0) return null;
  const raw = matches[matches.length - 1]?.[1];
  const n = raw ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 90) return null;
  return n;
}

export function learnWindow(now: Date, days: number): { startDate: string; endDate: string } {
  const parts = getJakartaDateParts(now);
  return {
    startDate: formatJakartaDateWithOffset(parts.year, parts.month, parts.day, 0),
    endDate: formatJakartaDateWithOffset(parts.year, parts.month, parts.day, days - 1),
  };
}

export function userMentionsPriority(text: string): boolean {
  return /\b(low|medium|high|rendah|sedang|tinggi)\b/i.test(text);
}

export function isPendingPlanFresh(plan: PendingTaskPlan, now = Date.now()): boolean {
  return now - plan.createdAt <= PENDING_PLAN_FRESH_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: perintah Docker yang sama.

Expected: PASS, 4 tes di file itu.

- [ ] **Step 5: Commit**

```bash
git add src/task-plan.ts test/task-plan.test.ts
git commit -m "feat: add task plan date window and freshness helpers"
```

---

### Task 2: Validasi dan format rencana minggu ini

**Files:**
- Modify: `src/task-plan.ts`
- Modify: `test/task-plan.test.ts`

**Interfaces:**
- Consumes: `PendingTaskPlan`, `StoredPlanOp`, `userMentionsPriority`, `currentWibWeekRange` dari `src/date.ts`, `TaskRecord` dari `src/types.ts`
- Produces:
  - `export type RawPlanOp = { op?: string; taskId?: string; title?: string; due_date?: string; priority?: string }`
  - `export type PlanValidation = { ok: true; plan: PendingTaskPlan; notices: string[] } | { ok: false; message: string }`
  - `export function validateWeekPlan(userText: string, tasks: TaskRecord[], ops: RawPlanOp[], now?: Date): PlanValidation`
  - `export function formatPlanReply(plan: PendingTaskPlan, notices: string[], tasks: TaskRecord[]): string`

- [ ] **Step 1: Write the failing test**

Tambahkan di `test/task-plan.test.ts`:

```ts
import type { TaskRecord } from "../src/types";
import { formatPlanReply, validateWeekPlan } from "../src/task-plan";

const now = new Date("2026-10-06T10:00:00+07:00");
const tasks: TaskRecord[] = [
  { id: "t1", task: "Revisi bab 2", status: "To Do", priority: "Medium", due: "2026-10-10" },
  { id: "t2", task: "Selesai", status: "Done", priority: "Low" },
];

it("keeps in-week updates and drops creates, unknown ids, and outside dates", () => {
  const result = validateWeekPlan("atur tugas minggu ini", tasks, [
    { op: "update", taskId: "t1", due_date: "2026-10-08", priority: "High" },
    { op: "update", taskId: "nope", due_date: "2026-10-08" },
    { op: "update", taskId: "t1", due_date: "2026-10-20" },
    { op: "create", title: "Baru", due_date: "2026-10-07" },
  ], now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.kind).toBe("week");
  expect(result.plan.ops).toEqual([
    { op: "update", taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" },
  ]);
});

it("refuses a week plan when nothing valid remains", () => {
  const result = validateWeekPlan("atur tugas minggu ini", [], [
    { op: "update", taskId: "t1", due_date: "2026-10-08" },
  ], now);
  expect(result).toEqual({ ok: false, message: "Tidak ada tugas aktif untuk diatur minggu ini." });
});

it("formats the old due and asks for ya or jangan", () => {
  const plan = {
    kind: "week" as const,
    createdAt: 1,
    ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  };
  const text = formatPlanReply(plan, [], tasks);
  expect(text).toContain("1. Revisi bab 2 — 2026-10-08 (sebelumnya 2026-10-10)");
  expect(text).toContain('Balas "ya" atau "jangan".');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: Docker `test/task-plan.test.ts`.

Expected: FAIL, `validateWeekPlan` tidak diekspor.

- [ ] **Step 3: Write minimal implementation**

Tambahkan di `src/task-plan.ts`:

```ts
import { currentWibWeekRange, formatJakartaDateWithOffset, getJakartaDateParts } from "./date";
import type { TaskRecord } from "./types";

export type RawPlanOp = {
  op?: string;
  taskId?: string;
  title?: string;
  due_date?: string;
  priority?: string;
};

export type PlanValidation =
  | { ok: true; plan: PendingTaskPlan; notices: string[] }
  | { ok: false; message: string };

function dateOnly(raw: string | undefined): string | null {
  const match = raw?.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

function asPriority(raw: string | undefined): PlanPriority | undefined {
  const lower = raw?.trim().toLowerCase();
  if (lower === "low") return "Low";
  if (lower === "medium") return "Medium";
  if (lower === "high") return "High";
  return undefined;
}

export function validateWeekPlan(
  userText: string,
  tasks: TaskRecord[],
  ops: RawPlanOp[],
  now: Date = new Date(),
): PlanValidation {
  const active = tasks.filter((task) => task.status === "To Do" || task.status === "Doing");
  if (active.length === 0) {
    return { ok: false, message: "Tidak ada tugas aktif untuk diatur minggu ini." };
  }
  const week = currentWibWeekRange(now);
  const keepPriority = userMentionsPriority(userText);
  const stored: StoredPlanOp[] = [];
  for (const op of ops) {
    if (op.op !== "update") continue;
    const task = active.find((item) => item.id === op.taskId);
    const due = dateOnly(op.due_date);
    if (!task || !due || due < week.startDate || due > week.endDate) continue;
    const priority = keepPriority ? asPriority(op.priority) : undefined;
    stored.push({
      op: "update",
      taskId: task.id,
      title: task.task,
      due_date: due,
      ...(priority ? { priority } : {}),
    });
  }
  if (stored.length === 0) {
    return { ok: false, message: "Tidak ada operasi yang cocok untuk minggu ini." };
  }
  return { ok: true, plan: { kind: "week", ops: stored, createdAt: now.getTime() }, notices: [] };
}

export function formatPlanReply(plan: PendingTaskPlan, notices: string[], tasks: TaskRecord[]): string {
  const lines = plan.ops.map((op, index) => {
    if (op.op === "update") {
      const previous = tasks.find((task) => task.id === op.taskId)?.due;
      const oldDue = previous ? previous.slice(0, 10) : "belum ada tenggat";
      return `${index + 1}. ${op.title} — ${op.due_date} (sebelumnya ${oldDue})`;
    }
    return `${index + 1}. ${op.title} — ${op.due_date}`;
  });
  const extra = notices.length ? `\n${notices.join("\n")}` : "";
  return `${lines.join("\n")}${extra}\nBalas "ya" atau "jangan".`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: Docker `test/task-plan.test.ts`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/task-plan.ts test/task-plan.test.ts
git commit -m "feat: validate and format a one-week task plan"
```

---

### Task 3: Validasi rencana belajar

**Files:**
- Modify: `src/task-plan.ts`
- Modify: `test/task-plan.test.ts`

**Interfaces:**
- Consumes: `parseLearningDays`, `learnWindow`, `userMentionsPriority`, `RawPlanOp`, `PlanValidation`, `TaskRecord`
- Produces: `export function validateLearnPlan(userText: string, tasks: TaskRecord[], ops: RawPlanOp[], now?: Date): PlanValidation`

- [ ] **Step 1: Write the failing test**

Tambahkan tes ini ke `test/task-plan.test.ts`. `now` dan `tasks` sudah ada di file itu dari tes minggu ini: `now` adalah `2026-10-06T10:00:00+07:00`, dan `tasks` memuat tugas aktif "Revisi bab 2".

```ts
it("asks for a day count and does not build a plan", () => {
  expect(validateLearnPlan("saya ingin belajar ROS", tasks, [
    { op: "create", title: "ROS basics", due_date: "2026-10-06" },
  ], now)).toEqual({
    ok: false,
    message: "Berapa hari? Sebut jumlahnya, misalnya 30 hari.",
  });
  expect(validateLearnPlan("belajar ROS 91 hari", tasks, [], now).ok).toBe(false);
});

it("caps at 8 creates, skips duplicates and updates, and defaults priority", () => {
  const ops = [
    { op: "update", taskId: "t1", due_date: "2026-10-07" },
    { op: "create", title: " Revisi bab 2 ", due_date: "2026-10-06" },
    ...Array.from({ length: 9 }, (_, i) => ({
      op: "create",
      title: `Langkah ${i + 1}`,
      due_date: "2026-10-06",
    })),
  ];
  const result = validateLearnPlan("belajar ROS dalam 30 hari", tasks, ops, now);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.plan.ops).toHaveLength(8);
  expect(result.plan.ops[0]).toEqual({
    op: "create",
    title: "Langkah 1",
    due_date: "2026-10-06",
    priority: "Medium",
  });
  expect(result.notices.join(" ")).toContain("1 usulan dipotong karena batas 8 tugas.");
  expect(result.notices.join(" ")).toContain("Revisi bab 2");
});

it("drops learn dates outside the window and does not save a duplicate-only plan", () => {
  expect(validateLearnPlan("belajar ROS dalam 1 hari", tasks, [
    { op: "create", title: "Besok", due_date: "2026-10-07" },
  ], now).ok).toBe(false);
  const dup = validateLearnPlan("belajar ROS dalam 30 hari", tasks, [
    { op: "create", title: "revisi bab 2", due_date: "2026-10-06" },
  ], now);
  expect(dup.ok).toBe(false);
  if (dup.ok) return;
  expect(dup.message).toContain("Revisi bab 2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: Docker `test/task-plan.test.ts`.

Expected: FAIL, `validateLearnPlan` tidak diekspor.

- [ ] **Step 3: Write minimal implementation**

```ts
const LEARN_CAP = 8;

export function validateLearnPlan(
  userText: string,
  tasks: TaskRecord[],
  ops: RawPlanOp[],
  now: Date = new Date(),
): PlanValidation {
  const days = parseLearningDays(userText);
  if (days === null) {
    return { ok: false, message: "Berapa hari? Sebut jumlahnya, misalnya 30 hari." };
  }
  const window = learnWindow(now, days);
  const activeTitles = new Set(
    tasks
      .filter((task) => task.status === "To Do" || task.status === "Doing")
      .map((task) => task.task.trim().toLowerCase()),
  );
  const keepPriority = userMentionsPriority(userText);
  const skipped: string[] = [];
  const stored: StoredPlanOp[] = [];
  let capped = 0;
  for (const op of ops) {
    if (op.op !== "create") continue;
    const title = op.title?.trim() ?? "";
    const due = dateOnly(op.due_date);
    if (!title || !due || due < window.startDate || due > window.endDate) continue;
    if (activeTitles.has(title.toLowerCase())) {
      skipped.push(title);
      continue;
    }
    if (stored.length >= LEARN_CAP) {
      capped += 1;
      continue;
    }
    const priority = (keepPriority ? asPriority(op.priority) : undefined) ?? "Medium";
    stored.push({ op: "create", title, due_date: due, priority });
  }
  if (stored.length === 0) {
    const why = skipped.length
      ? `Judul itu sudah ada di tugas aktif: ${skipped.join(", ")}.`
      : "Tidak ada tugas baru yang tanggalnya masuk jendela belajar.";
    return { ok: false, message: why };
  }
  const notices: string[] = [];
  if (capped > 0) notices.push(`${capped} usulan dipotong karena batas 8 tugas.`);
  if (skipped.length) notices.push(`Sudah ada di tugas aktif: ${skipped.join(", ")}.`);
  return { ok: true, plan: { kind: "learn", ops: stored, createdAt: now.getTime() }, notices };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: Docker `test/task-plan.test.ts`.

Expected: PASS. Tes cap harus melihat kata "dipotong" atau kalimat batas 8. Samakan notice di implementasi dengan assert tes: `tidak masuk karena batas 8`.

- [ ] **Step 5: Commit**

```bash
git add src/task-plan.ts test/task-plan.test.ts
git commit -m "feat: validate a bounded learning-day task plan"
```

---

### Task 4: KV pending_task_plan

**Files:**
- Modify: `src/state.ts`
- Test: `test/pending-task-plan-state.test.ts`

**Interfaces:**
- Consumes: `PendingTaskPlan` dari `src/task-plan.ts`, `Env` dari `src/types.ts`
- Produces:
  - `export async function savePendingTaskPlan(env: Env, userId: number | string, plan: PendingTaskPlan): Promise<void>`
  - `export async function getPendingTaskPlan(env: Env, userId: number | string): Promise<PendingTaskPlan | null>`
  - `export async function clearPendingTaskPlan(env: Env, userId: number | string): Promise<void>`
  - `clearMemory` juga menghapus `pending_task_plan:{userId}`

- [ ] **Step 1: Write the failing test**

Buat `test/pending-task-plan-state.test.ts` dengan `createMockKv` yang sama seperti `test/pending-delete-state.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import type { Env } from "../src/types";
import { clearMemory, clearPendingTaskPlan, getPendingTaskPlan, savePendingTaskPlan } from "../src/state";
import type { PendingTaskPlan } from "../src/task-plan";

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const sample: PendingTaskPlan = {
  kind: "week",
  ops: [{ op: "update", taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  createdAt: 1_700_000_000_000,
};

it("stores JSON at pending_task_plan with 3600s TTL", async () => {
  const kv = createMockKv();
  const env = { DEDUP_KV: kv } as unknown as Env;
  await savePendingTaskPlan(env, "62812", sample);
  expect(kv.put).toHaveBeenCalledWith(
    "pending_task_plan:62812",
    JSON.stringify(sample),
    { expirationTtl: 3600 },
  );
});

it("returns null for missing or invalid JSON and clear deletes the key", async () => {
  const kv = createMockKv();
  const env = { DEDUP_KV: kv } as unknown as Env;
  await expect(getPendingTaskPlan(env, "62812")).resolves.toBeNull();
  kv.store.set("pending_task_plan:62812", "not-json");
  await expect(getPendingTaskPlan(env, "62812")).resolves.toBeNull();
  kv.store.set("pending_task_plan:62812", JSON.stringify(sample));
  await clearPendingTaskPlan(env, "62812");
  expect(kv.store.has("pending_task_plan:62812")).toBe(false);
});

it("clearMemory also removes pending_task_plan", async () => {
  const kv = createMockKv();
  kv.store.set("pending_task_plan:62812", JSON.stringify(sample));
  const env = { DEDUP_KV: kv } as unknown as Env;
  await clearMemory(env, "62812");
  expect(kv.store.has("pending_task_plan:62812")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: Docker `test/pending-task-plan-state.test.ts`.

Expected: FAIL, `savePendingTaskPlan` tidak diekspor.

- [ ] **Step 3: Write minimal implementation**

Di `src/state.ts`, impor `PendingTaskPlan` dari `./task-plan`. Tambahkan:

```ts
function getPendingTaskPlanKey(userId: number | string): string {
  return `pending_task_plan:${userId}`;
}

export async function savePendingTaskPlan(env: Env, userId: number | string, plan: PendingTaskPlan): Promise<void> {
  await env.DEDUP_KV.put(getPendingTaskPlanKey(userId), JSON.stringify(plan), { expirationTtl: TTL_SECONDS });
}

export async function getPendingTaskPlan(env: Env, userId: number | string): Promise<PendingTaskPlan | null> {
  const data = await env.DEDUP_KV.get(getPendingTaskPlanKey(userId));
  if (!data) return null;
  try {
    return JSON.parse(data) as PendingTaskPlan;
  } catch {
    return null;
  }
}

export async function clearPendingTaskPlan(env: Env, userId: number | string): Promise<void> {
  await env.DEDUP_KV.delete(getPendingTaskPlanKey(userId));
}
```

Di `clearMemory`, tambahkan `env.DEDUP_KV.delete(getPendingTaskPlanKey(userId))` ke `Promise.all` yang sudah ada.

- [ ] **Step 4: Run test to verify it passes**

Run: Docker `test/pending-task-plan-state.test.ts`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state.ts test/pending-task-plan-state.test.ts
git commit -m "feat: store a pending task plan in KV"
```

---

### Task 5: Tool Gemini propose_task_plan

**Files:**
- Modify: `src/gemini.ts`
- Modify: `test/gemini.test.ts`

**Interfaces:**
- Consumes: daftar tool DM yang sudah ada (`toolDefs = isGroup ? [] : [...]`)
- Produces: function declaration `propose_task_plan` hanya pada DM, plus blok prompt `PLANNER_RULES`

- [ ] **Step 1: Write the failing test**

Di `test/gemini.test.ts`, ikuti pola tes Finance yang memakai `fakeFetch` dan `interaction(...)`.

```ts
it("includes propose_task_plan in DM and omits it in group", async () => {
  let dmBody: any;
  const dmFetch: typeof fetch = async (_input, init) => {
    dmBody = JSON.parse(String(init?.body));
    return interaction("Siap.");
  };
  await generateChatReply(config, { text: "Atur tugas minggu ini" }, {
    tasks: [],
    memories: [],
    chatContext: "dm",
  }, undefined, dmFetch);
  const dmNames = dmBody.tools[0].functionDeclarations.map((t: { name: string }) => t.name);
  expect(dmNames).toContain("propose_task_plan");
  const tool = dmBody.tools[0].functionDeclarations.find((t: { name: string }) => t.name === "propose_task_plan");
  expect(tool.parameters.properties.kind.enum).toEqual(["week", "learn"]);
  expect(dmBody.systemInstruction.parts[0].text).toContain("propose_task_plan");

  let groupBody: any;
  const groupFetch: typeof fetch = async (_input, init) => {
    groupBody = JSON.parse(String(init?.body));
    return interaction("Siap.");
  };
  await generateChatReply(config, { text: "Atur tugas minggu ini" }, {
    tasks: [],
    memories: [],
    chatContext: "group",
  }, undefined, groupFetch);
  expect(groupBody.tools).toBeUndefined();
  expect(groupBody.systemInstruction.parts[0].text).not.toContain("TASK PLANNER");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: Docker `test/gemini.test.ts -t "propose_task_plan"`.

Expected: FAIL, nama tool tidak ada.

- [ ] **Step 3: Write minimal implementation**

Tambahkan konstanta:

```ts
const PLANNER_RULES = [
  "TASK PLANNER (DM only):",
  "1. 'atur/susun/urutkan tugas minggu ini' → propose_task_plan kind=week dengan update ops. taskId wajib dari Active tasks. due_date YYYY-MM-DD di minggu WIB berjalan. Jangan create.",
  "2. 'belajar X dalam N hari' → propose_task_plan kind=learn dengan create ops. Sebar due_date dari hari ini sampai hari ke-N. Jangan update. Jangan tulis Learning/Goal.",
  "3. Satu sesi bertenggat ('belajar MQTT 30 menit malam ini') tetap create_notion_task, bukan planner.",
  "4. Jangan menulis Notion sendiri untuk rencana ini. Sistem menyimpan rencana dan menanyakan ya/jangan.",
].join(" ");
```

Di `src/gemini.ts`, array system prompt DM adalah cabang `...(isGroup ? [GROUP_CHAT_RULES] : [ ... ])`. Sisipkan `PLANNER_RULES` di cabang itu, tepat setelah `...(context.financeEnabled ? [FINANCE_RULES] : []),`. Jangan masukkan ke `GROUP_CHAT_RULES`.

Tambahkan objek tool ini sebagai elemen terakhir array `toolDefs` DM (`const toolDefs = isGroup ? [] : [ ... ]`), setelah spread `financeEnabled` dan sebelum `];`. Jangan bungkus dengan `financeEnabled`.

```ts
{
  type: "function",
  name: "propose_task_plan",
  description: "Proposes a task plan for Aldo to confirm. Does not write Notion. kind=week updates existing tasks this WIB week. kind=learn creates at most 8 new tasks across N days.",
  parameters: {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING", enum: ["week", "learn"] },
      ops: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            op: { type: "STRING", enum: ["update", "create"] },
            taskId: { type: "STRING" },
            title: { type: "STRING" },
            due_date: { type: "STRING", description: "YYYY-MM-DD WIB." },
            priority: { type: "STRING", enum: ["Low", "Medium", "High"] },
          },
          required: ["op", "due_date"],
        },
      },
    },
    required: ["kind", "ops"],
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: Docker `test/gemini.test.ts -t "propose_task_plan"`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gemini.ts test/gemini.test.ts
git commit -m "feat: offer a confirm-first task plan tool in DM"
```

---

### Task 6: Router menyimpan rencana dan menjalankan ya/jangan

**Files:**
- Modify: `src/router.ts`
- Modify: `test/router.test.ts`

**Interfaces:**
- Consumes: `validateWeekPlan`, `validateLearnPlan`, `formatPlanReply`, `isPendingPlanFresh`, `savePendingTaskPlan`, `getPendingTaskPlan`, `clearPendingTaskPlan`, `createTask`, `updateTask`, `isPositiveDeleteConfirm`, `isNegativeDeleteConfirm`
- Produces: alur DM yang memenuhi tes di spec bagian 9 untuk ya, jangan, id palsu, belajar, batas 8, N hilang, semua gagal, sebagian berhasil, rencana basi, hapus didahulukan, blok create/update, dan grup

- [ ] **Step 1: Write the failing tests**

Di `deps()` pada `test/router.test.ts`, tambahkan:

```ts
getPendingTaskPlan: vi.fn(async () => null),
savePendingTaskPlan: vi.fn(async () => undefined),
clearPendingTaskPlan: vi.fn(async () => undefined),
```

Tambahkan impor `currentWibWeekRange` dari `../src/date` dan `learnWindow` dari `../src/task-plan` di `test/router.test.ts`. Tanggal usulan minggu ini harus jatuh di minggu WIB saat tes berjalan.

```ts
const active = [{ id: "t1", task: "Revisi bab 2", status: "To Do" as const, priority: "Medium" as const, due: "2026-10-10" }];
const weekDue = currentWibWeekRange(new Date()).startDate;

it("saves a week plan and does not update Notion yet", async () => {
  const d = deps({
    listActiveTasks: vi.fn(async () => active),
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "propose_task_plan", args: { kind: "week", ops: [
        { op: "update", taskId: "t1", due_date: weekDue, priority: "High" },
        { op: "update", taskId: "missing", due_date: weekDue },
      ] } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "Atur tugas minggu ini" }, d);
  expect(d.updateTask).not.toHaveBeenCalled();
  const saved = (d.savePendingTaskPlan as any).mock.calls[0][2];
  expect(saved.kind).toBe("week");
  expect(saved.ops).toEqual([
    { op: "update", taskId: "t1", title: "Revisi bab 2", due_date: weekDue },
  ]);
  expect(reply).toContain("Revisi bab 2");
  expect(reply).toContain("jangan");
  expect(reply).not.toContain("missing");
});

it("applies every stored update on ya and on iyaa serius without Gemini", async () => {
  const plan = {
    kind: "week" as const,
    createdAt: Date.now(),
    ops: [
      { op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" },
      { op: "update" as const, taskId: "t2", title: "Bab 3", due_date: "2026-10-09" },
    ],
  };
  for (const text of ["ya", "Iyaa serius"]) {
    const d = deps({ getPendingTaskPlan: vi.fn(async () => plan) });
    const reply = await handleUserMessage(env, 123, config, { text }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.updateTask).toHaveBeenNthCalledWith(1, config, "t1", { due_date: "2026-10-08" });
    expect(d.updateTask).toHaveBeenNthCalledWith(2, config, "t2", { due_date: "2026-10-09" });
    expect(d.clearPendingTaskPlan).toHaveBeenCalledWith(env, 123);
    expect(reply).toContain("Berhasil 2");
  }
});

it("discards a stored plan on jangan without writes", async () => {
  const plan = {
    kind: "learn" as const,
    createdAt: Date.now(),
    ops: [{ op: "create" as const, title: "ROS basics", due_date: "2026-10-06", priority: "Medium" as const }],
  };
  const d = deps({ getPendingTaskPlan: vi.fn(async () => plan) });
  const reply = await handleUserMessage(env, 123, config, { text: "jangan" }, d);
  expect(d.createTask).not.toHaveBeenCalled();
  expect(d.clearPendingTaskPlan).toHaveBeenCalledWith(env, 123);
  expect(reply).toContain("Tidak ada tugas");
});

it("creates learn tasks on ya and keeps the plan when every write fails", async () => {
  const plan = {
    kind: "learn" as const,
    createdAt: Date.now(),
    ops: [{ op: "create" as const, title: "ROS basics", due_date: "2026-10-06", priority: "Medium" as const }],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    createTask: vi.fn(async () => { throw new Error("notion down"); }),
  });
  const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
  expect(d.updateTask).not.toHaveBeenCalled();
  expect(d.clearPendingTaskPlan).not.toHaveBeenCalled();
  expect(reply).toContain("Gagal");
  expect(reply).toContain("ROS basics");
});

it("clears the plan after a partial apply and names the failure", async () => {
  const plan = {
    kind: "learn" as const,
    createdAt: Date.now(),
    ops: [
      { op: "create" as const, title: "ROS basics", due_date: "2026-10-06", priority: "Medium" as const },
      { op: "create" as const, title: "Topics", due_date: "2026-10-07", priority: "Medium" as const },
    ],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    createTask: vi.fn(async ( _c, task: { task: string } ) => {
      if (task.task === "Topics") throw new Error("notion down");
      return "id";
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
  expect(d.clearPendingTaskPlan).toHaveBeenCalledWith(env, 123);
  expect(reply).toContain("Berhasil 1");
  expect(reply).toContain("Topics");
});

it("does not apply a plan older than 30 minutes", async () => {
  const plan = {
    kind: "week" as const,
    createdAt: Date.now() - 31 * 60 * 1000,
    ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    generateChatReply: vi.fn(async () => ({ type: "text", text: "Halo" })) as any,
  });
  await handleUserMessage(env, 123, config, { text: "ya" }, d);
  expect(d.updateTask).not.toHaveBeenCalled();
  expect(d.clearPendingTaskPlan).toHaveBeenCalledWith(env, 123);
  expect(d.generateChatReply).toHaveBeenCalled();
});

it("does not start a plan while a delete confirmation is pending", async () => {
  const d = deps({
    getPendingDelete: vi.fn(async () => ({
      kind: "tasks" as const,
      ids: ["task-9"],
      summary: "Revisi",
      createdAt: Date.now(),
    })),
  });
  const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
  expect(d.savePendingTaskPlan).not.toHaveBeenCalled();
  expect(d.generateChatReply).not.toHaveBeenCalled();
  expect(d.archiveTask).toHaveBeenCalledWith(config, "task-9");
  expect(reply).toContain("menghapus");
});

it("blocks task writes while a fresh plan is waiting", async () => {
  const plan = {
    kind: "week" as const,
    createdAt: Date.now(),
    ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "create_notion_task", args: { title: "Lain", priority: "Low" } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "tambah tugas lain" }, d);
  expect(d.createTask).not.toHaveBeenCalled();
  expect(reply).toContain("ya");
  expect(reply).toContain("jangan");
});

it("rejects propose_task_plan in a group", async () => {
  const d = deps({
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "propose_task_plan", args: { kind: "learn", ops: [
        { op: "create", title: "ROS", due_date: "2026-10-06" },
      ] } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "belajar ROS dalam 30 hari", chatContext: "group" }, d);
  expect(d.savePendingTaskPlan).not.toHaveBeenCalled();
  expect(reply.toLowerCase()).toContain("pribadi");
});

it("blocks update_notion_task while a fresh plan is waiting", async () => {
  const plan = {
    kind: "week" as const,
    createdAt: Date.now(),
    ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "update_notion_task", args: { taskId: "t1", due_date: "2026-10-09" } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "ubah tenggatnya" }, d);
  expect(d.updateTask).not.toHaveBeenCalled();
  expect(reply).toContain("jangan");
});

it("leaves a fresh plan stored when the message is neither ya nor jangan", async () => {
  const plan = {
    kind: "week" as const,
    createdAt: Date.now(),
    ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  };
  const d = deps({
    getPendingTaskPlan: vi.fn(async () => plan),
    generateChatReply: vi.fn(async () => ({ type: "text", text: "Halo" })) as any,
  });
  await handleUserMessage(env, 123, config, { text: "halo" }, d);
  expect(d.clearPendingTaskPlan).not.toHaveBeenCalled();
  expect(d.updateTask).not.toHaveBeenCalled();
  expect(d.generateChatReply).toHaveBeenCalled();
});

it("does not save a week plan when there are no active tasks", async () => {
  const d = deps({
    listActiveTasks: vi.fn(async () => []),
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "propose_task_plan", args: { kind: "week", ops: [
        { op: "update", taskId: "t1", due_date: weekDue },
      ] } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "Atur tugas minggu ini" }, d);
  expect(d.savePendingTaskPlan).not.toHaveBeenCalled();
  expect(reply).toContain("Tidak ada tugas aktif");
});

it("asks for a day count and does not save a learn plan", async () => {
  const d = deps({
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "propose_task_plan", args: { kind: "learn", ops: [
        { op: "create", title: "ROS basics", due_date: learnWindow(new Date(), 30).startDate },
      ] } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "saya ingin belajar ROS" }, d);
  expect(d.savePendingTaskPlan).not.toHaveBeenCalled();
  expect(reply).toContain("Berapa hari");
});

it("stores at most 8 learn creates and says the rest were cut", async () => {
  const today = learnWindow(new Date(), 30).startDate;
  const d = deps({
    listActiveTasks: vi.fn(async () => []),
    generateChatReply: vi.fn().mockResolvedValueOnce({
      type: "function_calls",
      calls: [{ name: "propose_task_plan", args: { kind: "learn", ops: Array.from({ length: 9 }, (_, i) => ({
        op: "create",
        title: `Langkah ${i + 1}`,
        due_date: today,
      })) } }],
    }) as any,
  });
  const reply = await handleUserMessage(env, 123, config, { text: "belajar ROS dalam 30 hari" }, d);
  const saved = (d.savePendingTaskPlan as any).mock.calls[0][2];
  expect(saved.ops).toHaveLength(8);
  expect(d.createTask).not.toHaveBeenCalled();
  expect(reply).toContain("dipotong karena batas 8");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: Docker `test/router.test.ts -t "week plan and does not|every stored update|stored plan on jangan|learn tasks on ya|partial apply|older than 30|delete confirmation is pending|fresh plan is waiting|update_notion_task while|neither ya|no active tasks|day count|at most 8|propose_task_plan in a group"`.

Expected: FAIL, karena router belum menangani `propose_task_plan` dan belum membaca rencana tersimpan.

- [ ] **Step 3: Write minimal implementation**

Tambahkan `getPendingTaskPlan`, `savePendingTaskPlan`, dan `clearPendingTaskPlan` ke impor dari `./state`. Di `RouterDeps`, tambahkan baris:

```ts
getPendingTaskPlan: typeof getPendingTaskPlan; savePendingTaskPlan: typeof savePendingTaskPlan; clearPendingTaskPlan: typeof clearPendingTaskPlan;
```

Di `defaultDeps`, masukkan ketiga fungsi itu di objek yang sama.

Sisipkan blok berikut setelah blok pending-memory (setelah `return \`Ok, sudah aku ingat *${pendingMemory.key}*.\`;`), masih di dalam `if (!isGroup)`, dan sebelum `detectBriefingRequest`. Blok hapus yang sudah ada tetap di atasnya.

```ts
const pendingPlan = await deps.getPendingTaskPlan(env, userId);
if (pendingPlan && !isPendingPlanFresh(pendingPlan)) {
  await deps.clearPendingTaskPlan(env, userId);
} else if (pendingPlan && isNegativeDeleteConfirm(normalizedText)) {
  await deps.clearPendingTaskPlan(env, userId);
  return "Ok, batal. Tidak ada tugas yang diubah.";
} else if (pendingPlan && isPositiveDeleteConfirm(normalizedText)) {
  let success = 0;
  const failed: string[] = [];
  for (const op of pendingPlan.ops) {
    try {
      if (op.op === "update") {
        await deps.updateTask(config, op.taskId, {
          due_date: op.due_date,
          ...(op.priority ? { priority: op.priority } : {}),
        });
      } else {
        await deps.createTask(config, { task: op.title, priority: op.priority, due_date: op.due_date });
      }
      success += 1;
    } catch {
      failed.push(op.title);
    }
  }
  if (success > 0) await deps.clearPendingTaskPlan(env, userId);
  const failLine = failed.length ? ` Gagal: ${failed.join(", ")}.` : "";
  return `Berhasil ${success} tugas.${failLine}`;
}
```

Blok pending-delete harus tetap di atas blok ini, supaya "ya" pada hapus yang tertunda tidak menjalankan rencana.

Di switch tool, tambahkan:

```ts
case "propose_task_plan": {
  if (isGroup) {
    replyMessages.push("Rencana tugas hanya di chat pribadi.");
    break;
  }
  const ops = Array.isArray(call.args.ops) ? call.args.ops : [];
  const validation = call.args.kind === "learn"
    ? validateLearnPlan(normalizedText, tasks, ops, new Date())
    : validateWeekPlan(normalizedText, tasks, ops, new Date());
  if (!validation.ok) {
    replyMessages.push(validation.message);
    break;
  }
  await deps.savePendingTaskPlan(env, userId, validation.plan);
  replyMessages.push(formatPlanReply(validation.plan, validation.notices, tasks));
  break;
}
```

Di baris pertama `case "create_notion_task"` (sebelum `stripInventedDueDate`) dan di baris pertama `case "update_notion_task"`, kalau `getPendingTaskPlan` mengembalikan rencana segar:

```ts
replyMessages.push('Masih ada rencana tugas yang menunggu. Balas "ya" atau "jangan" dulu.');
break;
```

Jangan panggil `createTask` atau `updateTask` pada cabang itu.

- [ ] **Step 4: Run test to verify it passes**

Run: Docker `test/router.test.ts` lalu `bash test-docker.sh`.

Expected: PASS. `bash test-docker.sh` keluar dengan kode 0.

- [ ] **Step 5: Commit**

```bash
git add src/router.ts test/router.test.ts
git commit -m "feat: confirm a task plan before writing Notion tasks"
```

---

## Spec coverage

| Spec | Task |
|---|---|
| DM only, grup ditolak | Task 5, Task 6 |
| Tool sekali, KV, ya tanpa Gemini | Task 4, Task 6 |
| jangan tidak menulis | Task 6 |
| Hanya createTask/updateTask | Task 6 |
| Kunci `pending_task_plan`, TTL 3600, segar 30 menit | Task 1, Task 4, Task 6 |
| Week: update saja, id asli, tanggal dalam minggu, tanpa Done | Task 2, Task 6 |
| Learn: N terakhir sebelum "hari", 1–90, jendela, cap 8, duplikat, Medium | Task 1, Task 3, Task 6 |
| Balasan bernomor, tenggat lama, notice potongan dan duplikat | Task 2, Task 3 |
| Semua gagal simpan rencana; sebagian berhasil hapus rencana | Task 6 |
| Hapus tertunda didahulukan | Task 6 |
| Blok create/update saat rencana segar | Task 6 |
| Modul murni tanpa Notion/KV | Task 1–3 |
