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
  const matches = [...text.toLowerCase().matchAll(/(\d{1,3})\s*hari\b/g)];
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
