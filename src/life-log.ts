import type { HealthKind, HealthRecord } from "./types";

export type { HealthKind };

export type HealthEntry = Omit<HealthRecord, "id"> & { id?: string };

export type CareerEntry = {
  name: string;
  url: string;
  date: string;
  notes?: string;
};

export type ReflectionDraft = {
  learned: string;
  built: string;
  income: string;
  timeWasted: string;
  improve: string;
  weekStart: string;
  createdAt: number;
};

export const REFLECTION_FRESH_MS = 30 * 60 * 1000;

export function asHealthKind(raw: string | undefined): HealthKind {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "workout" || text === "sleep" || text === "other") {
    if (text === "workout") return "Workout";
    if (text === "sleep") return "Sleep";
    return "Other";
  }
  if (/\b(tidur|sleep)\b/.test(text)) return "Sleep";
  if (/\b(workout|olahraga|gym|latihan)\b/.test(text)) return "Workout";
  return "Other";
}

export function formatHealthSummary(entries: HealthEntry[]): string {
  if (entries.length === 0) return "Belum ada catatan kesehatan untuk rentang ini.";
  const lines = entries.map((entry) => {
    const hours = entry.hours !== undefined ? ` — ${entry.hours} jam` : "";
    return `${entry.kind}: ${entry.name}${hours} (${entry.date.slice(0, 10)})`;
  });
  const sleep = entries.reduce((sum, entry) => (entry.kind === "Sleep" && entry.hours ? sum + entry.hours : sum), 0);
  const total = sleep > 0 ? `\nTotal tidur: ${sleep} jam.` : "";
  return `${lines.join("\n")}${total}`;
}

export function normalizeEvidenceUrl(raw: string | undefined): string | null {
  const url = raw?.trim() ?? "";
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

export function reflectionGaps(draft: Pick<ReflectionDraft, "learned" | "built" | "income" | "timeWasted" | "improve">): string[] {
  const fields: Array<[string, string]> = [
    ["Learned", draft.learned],
    ["Built", draft.built],
    ["Income", draft.income],
    ["Time wasted", draft.timeWasted],
    ["Improve", draft.improve],
  ];
  return fields.filter(([, value]) => !value.trim()).map(([label]) => label);
}

export function formatReflectionProposal(draft: ReflectionDraft): string {
  return [
    `Review minggu ${draft.weekStart}`,
    `Learned: ${draft.learned.trim()}`,
    `Built: ${draft.built.trim()}`,
    `Income: ${draft.income.trim()}`,
    `Time wasted: ${draft.timeWasted.trim()}`,
    `Improve: ${draft.improve.trim()}`,
    'Balas "ya" atau "jangan".',
  ].join("\n");
}

export function isPendingReflectionFresh(draft: ReflectionDraft, now = Date.now()): boolean {
  return now - draft.createdAt <= REFLECTION_FRESH_MS;
}
