import { currentWibWeekRange, formatJakartaDateWithOffset, getJakartaDateParts } from "./date";
import type { TaskRecord } from "./types";

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
