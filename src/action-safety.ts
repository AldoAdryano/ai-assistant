export type PendingDelete = {
  kind: "tasks" | "notes" | "memory";
  ids: string[];
  summary: string;
  createdAt: number;
};

const WORD_NUMBERS = ["dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh"];

const POSITIVE_CONFIRM = /\b(ya|yakin|hapus|boleh|ok|oke|lanjutkan)\b/i;
const NEGATIVE_CONFIRM = /\b(tidak|jangan|batal|cancel)\b/i;

const CLARIFY_MULTI_CREATE =
  "Aldo, mau jadi satu tugas atau beberapa? Tolong jelasin dulu ya.";

export function userExplicitMultiCreate(userText: string): boolean {
  const lower = userText.trim().toLowerCase();

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

export function isPositiveDeleteConfirm(userText: string): boolean {
  return POSITIVE_CONFIRM.test(userText.trim());
}

export function isNegativeDeleteConfirm(userText: string): boolean {
  return NEGATIVE_CONFIRM.test(userText.trim());
}
