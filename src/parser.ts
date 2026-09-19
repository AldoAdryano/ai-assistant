import type { ParsedIntent, Priority, NormalizedTaskResult } from "./types";
import { parseIndonesianDeadline } from "./date";

function clean(value: string): string {
  return value.replace(/^\s*[:,-]?\s*/, "").replace(/\s+/g, " ").trim();
}

function parsePriority(text: string): { text: string; priority: Priority } {
  const patterns: Array<[RegExp, Priority]> = [
    [/(?:,?\s*)prioritas\s+(?:tinggi|high)\b/i, "High"],
    [/(?:,?\s*)prioritas\s+(?:rendah|low)\b/i, "Low"],
    [/(?:,?\s*)prioritas\s+(?:sedang|medium)\b/i, "Medium"],
  ];
  for (const [pattern, priority] of patterns) {
    if (pattern.test(text)) return { text: clean(text.replace(pattern, "")), priority };
  }
  return { text: clean(text), priority: "Medium" };
}

function parseDue(text: string): { text: string; due?: string } {
  const iso = text.match(/(?:deadline|jatuh tempo)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso?.[1]) return { text: clean(text.replace(iso[0], "")), due: iso[1] };
  const local = text.match(/(?:deadline|jatuh tempo)\s+(\d{2})\/(\d{2})\/(\d{4})\b/i);
  if (local?.[1] && local[2] && local[3]) {
    return { text: clean(text.replace(local[0], "")), due: `${local[3]}-${local[2]}-${local[1]}` };
  }
  return { text: clean(text) };
}

export function parseDeterministicIntent(text: string, _now = new Date()): ParsedIntent | null {
  const raw = text.trim();
  const normalized = raw.toLocaleLowerCase("id-ID");
  if (/^(?:\/start(?:\s+\S+)?|\/help|bantuan|help|menu)\s*[.!?]*$/i.test(raw)) return { type: "HELP", raw };

  const recall = raw.match(/^apa yang kamu ingat tentang\s+(.+?)[?!.]*$/i);
  if (recall?.[1]) return { type: "RECALL", raw, query: clean(recall[1]) };

  const remember = raw.match(/^ingat bahwa\s+(.+)$/i);
  if (remember?.[1]) {
    const statement = clean(remember[1]);
    const split = statement.match(/^(.+?)\s+adalah\s+(.+)$/i);
    return {
      type: "REMEMBER", raw,
      key: clean(split?.[1] ?? statement),
      value: clean(split?.[2] ?? statement),
      category: "Other",
    };
  }

  if (/^(apa tugas saya|daftar tugas)(\s+saya)?\s*[?!.]*$/i.test(raw)) return { type: "LIST_TASKS", raw };

  const task = raw.match(/^tambah tugas\s+(.+)$/i);
  if (task?.[1]) {
    const due = parseDue(task[1]);
    const priority = parsePriority(due.text);
    return { type: "ADD_TASK", raw, text: priority.text, priority: priority.priority, ...(due.due ? { due: due.due } : {}) };
  }

  const idea = raw.match(/^(?:catat ide|simpan ide)\s*:?[ ]*(.+)$/i);
  if (idea?.[1]) return { type: "ADD_NOTE", raw, noteType: "Idea", text: clean(idea[1]) };

  const note = raw.match(/^catat\s+(.+)$/i);
  if (note?.[1]) return { type: "ADD_NOTE", raw, noteType: "Note", text: clean(note[1]) };

  if (normalized === "") return { type: "UNKNOWN", raw };
  return null;
}

export function normalizeTaskIntent(
  intent: ParsedIntent,
  originalText: string,
  referenceDate: Date = new Date()
): NormalizedTaskResult {
  let parseResult = parseIndonesianDeadline(originalText, referenceDate);

  let cleaned = originalText;

  // 1. Remove prefix
  const prefixRegex = /^(?:tambah\s+tugas(?:\s+kuliah)?|tugas(?:\s+kuliah)?|saya\s+harus|perlu)\s*:?\s*/i;
  cleaned = cleaned.replace(prefixRegex, "");

  if (parseResult.kind === "none") {
    const endDateRegex = /\b((?:hari\s+ini|besok|lusa|(?:hari\s+)?(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\s+depan|minggu\s+depan|(?:hari\s+)?(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)|(?:tanggal\s+)?\d{1,2}\s+(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\s+\d{4})?|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{4}|tanggal\s+\d{1,2}|januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember))$/i;
    const match = cleaned.match(endDateRegex);
    if (match) {
      parseResult = parseIndonesianDeadline("deadline " + match[1], referenceDate);
      if (parseResult.kind !== "none" && match[1]) {
        parseResult.matchedText = match[1];
      }
    }
  }

  // 2. Remove deadline marker and text after it
  const markerMatch = cleaned.match(/(?:,?\s*)(?:deadline|jatuh\s+tempo|due\s+date|due)\b/i);
  if (markerMatch && markerMatch.index !== undefined) {
    cleaned = cleaned.substring(0, markerMatch.index).trim();
  } else if (parseResult.kind !== "none" && parseResult.matchedText) {
    const matchedEnd = new RegExp(`(?:,?\\s*)${parseResult.matchedText}$`, "i");
    cleaned = cleaned.replace(matchedEnd, "").trim();
  }

  // 3. Separate context/subject (content)
  let title = cleaned;
  let content: string | undefined = undefined;

  const colonIndex = cleaned.indexOf(":");
  if (colonIndex !== -1) {
    content = cleaned.substring(0, colonIndex).trim();
    title = cleaned.substring(colonIndex + 1).trim();
  }

  const result: NormalizedTaskResult = {
    title: title.trim(),
    priority: intent.priority || "Medium",
    deadlineParseResult: parseResult,
    source: "Telegram"
  };

  if (parseResult.kind === "resolved" && parseResult.due) {
    result.due = parseResult.due;
  }
  if (content !== undefined) {
    result.content = content;
  }

  return result;
}
