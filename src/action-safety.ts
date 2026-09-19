import type { MemoryCategory } from "./types";

export type PendingDelete = {
  kind: "tasks" | "notes" | "memory" | "project";
  ids: string[];
  summary: string;
  createdAt: number;
};

export type PendingMemory = {
  key: string;
  value: string;
  category: Exclude<MemoryCategory, "Profile">;
  createdAt: number;
};

/** Pending delete confirmations older than this are ignored and cleared. */
export const PENDING_DELETE_FRESH_MS = 10 * 60 * 1000;

const WORD_NUMBERS = ["dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh"];

const NEGATIVE_CONFIRM = /\b(tidak|jangan|batal|cancel)\b/i;

const CLARIFY_MULTI_CREATE =
  "Aldo, mau jadi satu tugas atau beberapa? Tolong jelasin dulu ya.";

export function userExplicitMultiCreate(userText: string): boolean {
  const lower = userText.trim().toLowerCase();

  if (/\b(beberapa|pisah|terpisah|banyak)\b/.test(lower)) {
    return true;
  }

  if (/\b(?:buat|bikin|create|add)\s+\d+\s+tugas\b/.test(lower)) {
    return true;
  }

  for (const word of WORD_NUMBERS) {
    if (new RegExp(`\\b(?:buat|bikin|create|add)\\s+${word}\\s+tugas\\b`).test(lower)) {
      return true;
    }
  }

  return false;
}

export function filterCreateTaskCalls<T extends { name: string; args: any }>(
  calls: T[],
  userText: string,
): {
  allowed: T[];
  blocked: boolean;
  clarifyMessage?: string;
} {
  const createCalls = calls.filter((c) => c.name === "create_notion_task");
  const nonCreateCalls = calls.filter((c) => c.name !== "create_notion_task");

  if (createCalls.length <= 1) {
    return { allowed: calls, blocked: false };
  }

  if (userExplicitMultiCreate(userText)) {
    return { allowed: calls, blocked: false };
  }

  return {
    allowed: nonCreateCalls,
    blocked: true,
    clarifyMessage: CLARIFY_MULTI_CREATE,
  };
}

/** Short, confirmation-ish replies only — not bare "hapus" or long unrelated chat. */
export function isPositiveDeleteConfirm(userText: string): boolean {
  const text = userText.trim().toLowerCase();
  if (
    /^(ya|iya|iyalah|iyah|yoi|yep|yup|yes|yakin|boleh|ok|oke|lanjutkan|setuju|gas|sip)([!.]*)?$/i.test(
      text,
    )
  ) {
    return true;
  }
  // Short "ya …" / "iya …" / "yakin …" — not long unrelated messages
  if (/^(ya|iya|iyalah|iyah|yakin)\b/i.test(text) && text.length < 40) {
    return true;
  }
  return false;
}

export function isNegativeDeleteConfirm(userText: string): boolean {
  return NEGATIVE_CONFIRM.test(userText.trim());
}

/** True if the user message itself mentions a due date / time (not the model inventing one). */
export function userMentionsDeadline(userText: string): boolean {
  const t = userText.toLowerCase();
  return (
    /\b(deadline|tenggat|due|jatuh\s*tempo)\b/.test(t) ||
    /\b(besok|lusa|kemarin|hari\s+ini)\b/.test(t) ||
    /\b(senin|selasa|rabu|kamis|jumat|jum'?at|sabtu|minggu)(\s+depan)?\b/.test(t) ||
    /\bminggu\s+depan\b/.test(t) ||
    /\btanggal\s+\d{1,2}\b/.test(t) ||
    /\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/.test(t) ||
    /\b\d{4}-\d{2}-\d{2}\b/.test(t) ||
    /\bjam\s+\d{1,2}/.test(t)
  );
}

/**
 * Strip due_date/due_time from create_notion_task when the user never mentioned a deadline.
 * Returns whether an invented due was removed.
 */
export function stripInventedDueDate<T extends { name: string; args: any }>(
  call: T,
  userText: string,
): { call: T; stripped: boolean } {
  if (call.name !== "create_notion_task") {
    return { call, stripped: false };
  }
  const hasDue = Boolean(call.args?.due_date || call.args?.due_time);
  if (!hasDue) {
    return { call, stripped: false };
  }
  if (userMentionsDeadline(userText)) {
    return { call, stripped: false };
  }
  const nextArgs = { ...call.args };
  delete nextArgs.due_date;
  delete nextArgs.due_time;
  return { call: { ...call, args: nextArgs }, stripped: true };
}

export function isPendingDeleteFresh(pending: PendingDelete, now = Date.now()): boolean {
  return now - pending.createdAt <= PENDING_DELETE_FRESH_MS;
}

const EXPLICIT_REMEMBER =
  /\b(?:ingat|inget)(?:\s+(?:bahwa|ya|juga|dong|kalau|kalo))+\b|\b(?:ingat|inget)\s+bahwa\b|\boi+ya[,!]?\s+(?:ingat|inget)\b|\b(?:simpan\s+(?:preferensi|memori)|catat\s+di\s+memori|remember\s+that)\b/i;

export function userExplicitRemember(userText: string): boolean {
  return EXPLICIT_REMEMBER.test(userText.trim());
}

export function shouldConfirmMemoryWrite(input: {
  userText: string;
  category: string;
}): boolean {
  if (input.category === "Pattern") {
    return true;
  }
  return !userExplicitRemember(input.userText);
}

export function formatMemoryPropose(pending: PendingMemory): string {
  return `Aldo, mau aku ingat *${pending.key}*: ${pending.value} (${pending.category})? Balas "ya" atau "jangan".`;
}

export function isPendingMemoryFresh(pending: PendingMemory, now = Date.now()): boolean {
  return now - pending.createdAt <= PENDING_DELETE_FRESH_MS;
}

const TITLE_MAX = 40;

export function truncateTitle(title: string, max = TITLE_MAX): string {
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

/** Build a short summary of up to 3 titles for the confirm prompt. */
export function buildDeleteTitleSummary(titles: string[]): string {
  return titles.slice(0, 3).map((t) => truncateTitle(t)).join(", ");
}
