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
  const n = userText
    .toLowerCase()
    // WhatsApp / Unicode noise that breaks ^...$ anchors
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(briefing|ringkasin?\s+tugas|ringkas\s+tugas|apa\s+tugas\s+saya|daftar\s+tugas(?:\s+hari\s+ini)?|tugas\s+hari\s+ini)\??[!.,]*$/i.test(
      n,
    )
  ) {
    return true;
  }
  // "briefing woi/dong/sekarang/tugas" — short imperative, not a long topic sentence
  if (/^briefing(?:\s+(?:woi|dong|ya|yuk|please|tolong|sekarang|tugas|lagi)){1,3}\??[!.,]*$/i.test(n)) {
    return true;
  }
  return false;
}

export function emptyBriefingReply(): string {
  return "Hmph. Untuk sekarang sih lagi sepi, Tuan Muda — tidak ada yang overdue, due hari ini, atau mepet 24 jam. Santai dulu, jangan malah bikin tugas fiktif! 😌";
}
