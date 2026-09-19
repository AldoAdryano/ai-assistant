import type { DeadlineParseResult } from "./types";

export function nowWib(baseDate: Date = new Date()): Date {
  // Returns unshifted absolute epoch Date. Shifting should only happen during formatting.
  return baseDate;
}

export function getWibTimeLabel(hour: number): string {
  if (hour >= 0 && hour <= 10) return "Pagi";
  if (hour >= 11 && hour <= 14) return "Siang";
  if (hour >= 15 && hour <= 18) return "Sore";
  return "Malam";
}

export function getJakartaDateParts(date: Date): { year: number; month: number; day: number } {
  // Shift the date to WIB (+7 hours) for UTC extraction
  const localDate = new Date(date.getTime() + 7 * 3600000);
  return {
    year: localDate.getUTCFullYear(),
    month: localDate.getUTCMonth() + 1,
    day: localDate.getUTCDate()
  };
}

export function formatJakartaDateWithOffset(year: number, month: number, day: number, daysOffset: number): string {
  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + daysOffset);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dateStr = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dateStr}`;
}

export function parseIndonesianNaturalDate(input: string, referenceDate: Date): string | null {
  const refParts = getJakartaDateParts(referenceDate);
  const normalized = input.toLowerCase().replace(/\s+/g, " ").trim();

  let offset = 0;
  if (normalized === "hari ini") offset = 0;
  else if (normalized === "besok") offset = 1;
  else if (normalized === "lusa") offset = 2;
  else if (normalized === "kemarin") offset = -1;
  else if (normalized === "minggu depan") {
    // Return next week (defaulting to next Monday or +7)
    // Actually if they just say "minggu depan", let's give them +7 days
    offset = 7;
  }
  else {
    const dayMatch = normalized.match(/^(?:hari\s+)?(senin|selasa|rabu|kamis|jumat|sabtu|minggu)(?:\s+(depan|minggu\s+depan))?$/);
    if (dayMatch) {
      const dayName = dayMatch[1]!;
      const isNextWeek = !!dayMatch[2];
      
      const d = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day, 12, 0, 0));
      const currentWeekday = d.getUTCDay();
      const targetWeekday = WEEKDAYS[dayName]!;
      
      if (isNextWeek) {
        const daysToNextMonday = currentWeekday === 0 ? 1 : 8 - currentWeekday;
        const offsetFromMonday = targetWeekday === 0 ? 6 : targetWeekday - 1;
        offset = daysToNextMonday + offsetFromMonday;
      } else {
        let diff = targetWeekday - currentWeekday;
        if (diff <= 0) diff += 7;
        offset = diff;
      }
    } else {
      return null;
    }
  }

  return formatJakartaDateWithOffset(refParts.year, refParts.month, refParts.day, offset);
}

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12
};

const WEEKDAYS: Record<string, number> = {
  minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6
};

function isValidDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const MARKER_PATTERN = "(?:deadline\\s+hari|deadline|jatuh\\s+tempo|due\\s+date|due)";

export function parseIndonesianDeadline(input: string, now?: Date): DeadlineParseResult {
  const referenceDate = now ? now : nowWib();
  const refParts = getJakartaDateParts(referenceDate);
  const patterns = [
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(hari\\s+ini|besok|lusa)(?!\\w)`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const rel = m[2]!.toLowerCase().replace(/\\s+/g, " ");
        let offset = 0;
        if (rel === "besok") offset = 1;
        if (rel === "lusa") offset = 2;
        return { kind: "resolved", due: formatJakartaDateWithOffset(refParts.year, refParts.month, refParts.day, offset) };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(?:hari\\s+)?(senin|selasa|rabu|kamis|jumat|sabtu)\\s+depan`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const dayName = m[2]!.toLowerCase();
        const d = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day, 12, 0, 0));
        const currentWeekday = d.getUTCDay();
        const daysToNextMonday = currentWeekday === 0 ? 1 : 8 - currentWeekday;
        const targetWeekday = WEEKDAYS[dayName]!;
        const offsetFromMonday = targetWeekday === 0 ? 6 : targetWeekday - 1;
        return { kind: "resolved", due: formatJakartaDateWithOffset(refParts.year, refParts.month, refParts.day, daysToNextMonday + offsetFromMonday) };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+hari\\s+(minggu)\\s+depan`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const d = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day, 12, 0, 0));
        const currentWeekday = d.getUTCDay();
        const daysToNextMonday = currentWeekday === 0 ? 1 : 8 - currentWeekday;
        // Minggu is 0, offsetFromMonday for Sunday is 6
        return { kind: "resolved", due: formatJakartaDateWithOffset(refParts.year, refParts.month, refParts.day, daysToNextMonday + 6) };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+minggu\\s+depan`, "i"),
      resolve: (): any => ({ kind: "needs_clarification", reason: "missing_weekday" })
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(senin|selasa|rabu|kamis|jumat|sabtu|minggu)(?!\\s+depan)`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const dayName = m[2]!.toLowerCase();
        const d = new Date(Date.UTC(refParts.year, refParts.month - 1, refParts.day, 12, 0, 0));
        const currentWeekday = d.getUTCDay();
        const targetWeekday = WEEKDAYS[dayName]!;
        let diff = targetWeekday - currentWeekday;
        if (diff <= 0) diff += 7;
        return { kind: "resolved", due: formatJakartaDateWithOffset(refParts.year, refParts.month, refParts.day, diff) };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(?:tanggal\\s+)?(\\d{1,2})\\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)(?:\\s+(\\d{4}))?`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const targetDay = parseInt(m[2]!, 10);
        const targetMonth = MONTHS[m[3]!.toLowerCase()]!;
        const yearStr = m[4];
        let targetYear = yearStr ? parseInt(yearStr, 10) : refParts.year;

        if (!yearStr) {
          const currentVal = refParts.year * 10000 + refParts.month * 100 + refParts.day;
          const targetVal = refParts.year * 10000 + targetMonth * 100 + targetDay;
          if (targetVal < currentVal) {
            targetYear += 1;
          }
        }

        if (!isValidDate(targetYear, targetMonth, targetDay)) return null;
        return { kind: "resolved", due: `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}` };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(\\d{4}-\\d{1,2}-\\d{1,2})`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const [y, mo, d] = m[2]!.split("-").map(Number);
        if (!isValidDate(y!, mo!, d!)) return null;
        return { kind: "resolved", due: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(\\d{1,2}/\\d{1,2}/\\d{4})`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        const [d, mo, y] = m[2]!.split("/").map(Number);
        if (!isValidDate(y!, mo!, d!)) return null;
        return { kind: "resolved", due: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(?:tanggal\\s+)?(\\d{1,2})(?!\\s*(?:/|-))`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        return { kind: "needs_clarification", reason: "missing_month", partial: { date: parseInt(m[2]!, 10) } };
      }
    },
    {
      regex: new RegExp(`(${MARKER_PATTERN})\\s+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)`, "i"),
      resolve: (m: RegExpMatchArray): any => {
        return { kind: "needs_clarification", reason: "missing_day", partial: { month: MONTHS[m[2]!.toLowerCase()]! } };
      }
    }
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern.regex);
    if (match) {
      const result = pattern.resolve(match);
      if (result) {
        return { ...result, matchedText: match[0] };
      }
    }
  }

  return { kind: "none" };
}

function formatISOWithOffset(date: Date, offsetHours: number): string {
  const localDate = new Date(date.getTime() + offsetHours * 3600000);
  const y = localDate.getUTCFullYear();
  const m = String(localDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(localDate.getUTCDate()).padStart(2, '0');
  const h = String(localDate.getUTCHours()).padStart(2, '0');
  const min = String(localDate.getUTCMinutes()).padStart(2, '0');
  const s = String(localDate.getUTCSeconds()).padStart(2, '0');
  const sign = offsetHours >= 0 ? '+' : '-';
  const offH = String(Math.abs(offsetHours)).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}${sign}${offH}:00`;
}

export function normalizeNotionDue(raw: string | undefined | null, now?: Date): string | undefined {
  if (!raw) return undefined;
  
  const refDate = now ? now : nowWib();
  const refParts = getJakartaDateParts(refDate);
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return undefined;
    
    // Backend Guard: if year/month of Gemini's due date doesn't match nowWib
    // OR if user said "hari ini" (we approximate this by checking if it differs from current year/month)
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1; // getUTCMonth is 0-indexed, so add 1
    
    if (y !== refParts.year || m !== refParts.month) {
      // Overwrite the date part to today's date in WIB, preserve time and offset
      return `${refParts.year}-${String(refParts.month).padStart(2, "0")}-${String(refParts.day).padStart(2, "0")}T${raw.split("T")[1]}`;
    }
    
    return formatISOWithOffset(d, 7);
  }

  // 2. Natural language using parseIndonesianDeadline (prepend "deadline " to trigger regex)
  const parsed = parseIndonesianDeadline(`deadline ${raw}`, now);
  if (parsed.kind === "resolved" && parsed.due) {
    let timeMatch = raw.match(/jam\s+(\d{1,2})(?:[:.](\d{1,2}))?(?:\s*(pagi|siang|sore|malam))?/i);
    if (!timeMatch) timeMatch = raw.match(/(\d{1,2})[:.](\d{1,2})(?:\s*(pagi|siang|sore|malam))?/i);
    
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]!, 10);
      const mins = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3]?.toLowerCase();
      
      if (ampm === "malam" && hours < 12) hours += 12;
      if (ampm === "sore" && hours < 12 && hours >= 3) hours += 12;
      if (ampm === "siang" && hours < 12 && hours >= 1) hours += 12;
      
      const hh = String(hours).padStart(2, "0");
      const mm = String(mins).padStart(2, "0");
      return `${parsed.due}T${hh}:${mm}:00+07:00`;
    }
    
    return parsed.due;
  }
  
  return undefined;
}

export function stripDeadlineLeakFromTitle(title: string): string {
  if (!title) return title;
  let clean = title.replace(/\n?\s*Konteks:\s*Deadline.*$/i, "");
  clean = clean.replace(/\s*deadline\s+jam\s+\d{1,2}[:.]\d{1,2}.*$/i, "");
  return clean.trim();
}
