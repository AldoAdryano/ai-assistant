export type PendingDelete = {
  kind: "tasks" | "notes" | "memory";
  ids: string[];
  summary: string;
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
  if (/^(ya|yakin|boleh|ok|oke|lanjutkan)([!.]*)?$/i.test(text)) {
    return true;
  }
  // Short "ya …" / "yakin …" (e.g. "ya hapus") — not long unrelated messages
  if (/^(ya|yakin)\b/i.test(text) && text.length < 40) {
    return true;
  }
  return false;
}

export function isNegativeDeleteConfirm(userText: string): boolean {
  return NEGATIVE_CONFIRM.test(userText.trim());
}

export function isPendingDeleteFresh(pending: PendingDelete, now = Date.now()): boolean {
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
