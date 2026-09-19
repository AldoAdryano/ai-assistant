import { describe, it, expect } from "vitest";
import { getJakartaDateParts, formatJakartaDateWithOffset, parseIndonesianDeadline, normalizeNotionDue, stripDeadlineLeakFromTitle, parseIndonesianNaturalDate } from "../src/date";

describe("parseIndonesianNaturalDate (Task 1)", () => {
  it("resolves relative days correctly (kemarin, hari ini, besok, lusa)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // Monday

    expect(parseIndonesianNaturalDate("kemarin", ref)).toBe("2026-08-30");
    expect(parseIndonesianNaturalDate("hari ini", ref)).toBe("2026-08-31");
    expect(parseIndonesianNaturalDate("besok", ref)).toBe("2026-09-01");
    expect(parseIndonesianNaturalDate("lusa", ref)).toBe("2026-09-02");
  });

  it("resolves weekdays combined with depan", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // Monday

    expect(parseIndonesianNaturalDate("senin depan", ref)).toBe("2026-09-07");
    expect(parseIndonesianNaturalDate("selasa depan", ref)).toBe("2026-09-08");
    expect(parseIndonesianNaturalDate("hari rabu depan", ref)).toBe("2026-09-09");
    expect(parseIndonesianNaturalDate("senin minggu depan", ref)).toBe("2026-09-07");
    expect(parseIndonesianNaturalDate("hari selasa minggu depan", ref)).toBe("2026-09-08");
  });

  it("resolves minggu depan as next monday", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    // Usually minggu depan = next week, defaulting to monday or just +7? Let's say +7
    expect(parseIndonesianNaturalDate("minggu depan", ref)).toBe("2026-09-07");
  });

  it("resolves bare weekdays", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    expect(parseIndonesianNaturalDate("selasa", ref)).toBe("2026-09-01");
  });

  it("returns null for unparseable input", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    expect(parseIndonesianNaturalDate("tidak jelas", ref)).toBeNull();
  });
});

describe("Date primitives (Task 1)", () => {
  it("getJakartaDateParts returns local calendar parts for Asia/Jakarta timezone boundary (not UTC)", () => {
    // 2026-08-31 01:00:00 UTC+7 (Jakarta)
    // 2026-08-30 18:00:00 UTC
    // This proves the parser relies on Jakarta local time, not UTC.
    const ref = new Date("2026-08-30T18:00:00Z");
    
    const parts = getJakartaDateParts(ref);
    
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(8);
    expect(parts.day).toBe(31); // It is the 31st in Jakarta!
  });

  it("formatJakartaDateWithOffset calculates dates deterministically without host timezone leakage", () => {
    // Start with 2026-08-31
    const result = formatJakartaDateWithOffset(2026, 8, 31, 1);
    expect(result).toBe("2026-09-01"); // +1 day correctly wraps to September
    
    const lusa = formatJakartaDateWithOffset(2026, 8, 31, 2);
    expect(lusa).toBe("2026-09-02");
  });

  it("parseIndonesianDeadline resolves relative days (hari ini, besok, lusa) and extracts matched text", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // Monday

    const r1 = parseIndonesianDeadline("tugas A deadline hari ini", ref);
    expect(r1).toEqual({ kind: "resolved", due: "2026-08-31", matchedText: "deadline hari ini" });

    const r2 = parseIndonesianDeadline("tugas B jatuh tempo besok", ref);
    expect(r2).toEqual({ kind: "resolved", due: "2026-09-01", matchedText: "jatuh tempo besok" });

    const r3 = parseIndonesianDeadline("tugas C due lusa", ref);
    expect(r3).toEqual({ kind: "resolved", due: "2026-09-02", matchedText: "due lusa" });
  });

  it("parseIndonesianDeadline resolves bare weekdays strictly in the future (1-7 days)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // Monday

    const rSenin = parseIndonesianDeadline("tugas deadline Senin", ref);
    expect(rSenin).toEqual({ kind: "resolved", due: "2026-09-07", matchedText: "deadline Senin" });

    const rSelasa = parseIndonesianDeadline("tugas due date selasa", ref);
    expect(rSelasa).toEqual({ kind: "resolved", due: "2026-09-01", matchedText: "due date selasa" });
  });

  it("parseIndonesianDeadline resolves '<weekday> depan' to the next calendar week (with or without 'hari')", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // Monday

    const rSenin = parseIndonesianDeadline("tugas deadline hari Senin depan", ref);
    expect(rSenin).toEqual({ kind: "resolved", due: "2026-09-07", matchedText: "deadline hari Senin depan" });

    const rSelasa = parseIndonesianDeadline("tugas deadline hari Selasa depan", ref);
    expect(rSelasa).toEqual({ kind: "resolved", due: "2026-09-08", matchedText: "deadline hari Selasa depan" });

    const rMinggu = parseIndonesianDeadline("tugas deadline hari Minggu depan", ref);
    expect(rMinggu).toEqual({ kind: "resolved", due: "2026-09-13", matchedText: "deadline hari Minggu depan" });
    
    const rSelasaWithoutHari = parseIndonesianDeadline("tugas deadline Selasa depan", ref);
    expect(rSelasaWithoutHari).toEqual({ kind: "resolved", due: "2026-09-08", matchedText: "deadline Selasa depan" });
  });

  it("parseIndonesianDeadline detects 'minggu depan' as ambiguous (missing_weekday)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas deadline minggu depan", ref);
    expect(result).toEqual({
      kind: "needs_clarification",
      reason: "missing_weekday",
      matchedText: "deadline minggu depan"
    });
  });

  it("parseIndonesianDeadline detects missing month as ambiguous (missing_month)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas deadline tanggal 5", ref);
    expect(result).toEqual({
      kind: "needs_clarification",
      reason: "missing_month",
      partial: { date: 5 },
      matchedText: "deadline tanggal 5"
    });
  });

  it("parseIndonesianDeadline detects missing day as ambiguous (missing_day)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas deadline Agustus", ref);
    expect(result).toEqual({
      kind: "needs_clarification",
      reason: "missing_day",
      partial: { month: 8 },
      matchedText: "deadline Agustus"
    });
  });

  it("parseIndonesianDeadline detects case-insensitive ambiguity", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas DeAdLiNe MiNgGu DePaN", ref);
    expect(result.kind).toBe("needs_clarification");
    expect(result.reason).toBe("missing_weekday");
  });

  it("parseIndonesianDeadline resolves explicit calendar dates with year", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas deadline 5 September 2026", ref);
    expect(result).toEqual({ kind: "resolved", due: "2026-09-05", matchedText: "deadline 5 September 2026" });
  });

  it("parseIndonesianDeadline infers year (nearest future) for day + month", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00"); // 31 Aug 2026

    const rFuture = parseIndonesianDeadline("tugas deadline 5 September", ref);
    expect(rFuture).toEqual({ kind: "resolved", due: "2026-09-05", matchedText: "deadline 5 September" });

    const rPast = parseIndonesianDeadline("tugas deadline 5 Agustus", ref);
    expect(rPast).toEqual({ kind: "resolved", due: "2027-08-05", matchedText: "deadline 5 Agustus" });
    
    // Equal to today resolves to today
    const rToday = parseIndonesianDeadline("tugas deadline 31 Agustus", ref);
    expect(rToday).toEqual({ kind: "resolved", due: "2026-08-31", matchedText: "deadline 31 Agustus" });
  });

  it("parseIndonesianDeadline resolves approved numeric date formats", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");

    const rIso = parseIndonesianDeadline("tugas deadline 2026-09-05", ref);
    expect(rIso).toEqual({ kind: "resolved", due: "2026-09-05", matchedText: "deadline 2026-09-05" });

    const rSlash = parseIndonesianDeadline("tugas deadline 05/09/2026", ref);
    expect(rSlash).toEqual({ kind: "resolved", due: "2026-09-05", matchedText: "deadline 05/09/2026" });
  });

  it("parseIndonesianDeadline does not silently normalize impossible dates", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");

    const rText = parseIndonesianDeadline("tugas deadline 31 Februari 2026", ref);
    expect(rText.kind).not.toBe("resolved");

    const rNum = parseIndonesianDeadline("tugas deadline 31/02/2026", ref);
    expect(rNum.kind).not.toBe("resolved");

    const rIso = parseIndonesianDeadline("tugas deadline 2026-02-31", ref);
    expect(rIso.kind).not.toBe("resolved");
  });

  it("parseIndonesianDeadline is case-insensitive", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const result = parseIndonesianDeadline("tugas jAtUh tEmPo haRI SeLasa DePan", ref);
    expect(result).toEqual({ kind: "resolved", due: "2026-09-08", matchedText: "jAtUh tEmPo haRI SeLasa DePan" });
  });
});

describe("Task 53: Normalization and Title Sanitation", () => {
  it("normalizeNotionDue standardizes dates and times to UTC+7 ISO 8601", () => {
    // Kosong -> undefined
    expect(normalizeNotionDue(undefined)).toBeUndefined();
    expect(normalizeNotionDue(null)).toBeUndefined();
    expect(normalizeNotionDue("")).toBeUndefined();
    
    // Date-only -> let it be
    expect(normalizeNotionDue("2026-09-02")).toBe("2026-09-02");
    
    // DateTime string -> enforce +07:00
    expect(normalizeNotionDue("2026-09-02T16:46:00+07:00")).toBe("2026-09-02T16:46:00+07:00");
    
    // Natural strings with time -> ISO
    const ref = new Date("2026-09-02T10:00:00+07:00");
    expect(normalizeNotionDue("hari ini jam 17:11", ref)).toBe("2026-09-02T17:11:00+07:00");
    expect(normalizeNotionDue("besok jam 8 malam", ref)).toBe("2026-09-03T20:00:00+07:00");
    expect(normalizeNotionDue("selasa depan 09:30", ref)).toBe("2026-09-08T09:30:00+07:00");
    expect(normalizeNotionDue("hari ini jam 18.08", ref)).toBe("2026-09-02T18:08:00+07:00");
    expect(normalizeNotionDue("hari ini 18.8", ref)).toBe("2026-09-02T18:08:00+07:00");
    
    // Natural strings without time -> date only
    expect(normalizeNotionDue("hari ini", ref)).toBe("2026-09-02");
    expect(normalizeNotionDue("besok", ref)).toBe("2026-09-03");

    // Task 54: Backend Guard for Gemini hallucinating frozen date (2026-03-31)
    const refSept = new Date("2026-09-02T16:56:00+07:00");
    // Gemini outputs March 31, 2026 but we are in September 2, 2026. Guard overwrites year/month/day to nowWib().
    expect(normalizeNotionDue("2026-03-31T17:57:00+07:00", refSept)).toBe("2026-09-02T17:57:00+07:00");
    // Gemini outputs next year but it's not today. Actually wait, if the user explicitly wants 2027, the guard overwrites it. 
    // This is expected per instruction for Task 54 due to Gemini's frozen clock.
  });

  it("stripDeadlineLeakFromTitle removes context and deadline information from task title", () => {
    expect(stripDeadlineLeakFromTitle("Merapikan meja Konteks: Deadline jam 16:46")).toBe("Merapikan meja");
    expect(stripDeadlineLeakFromTitle("Merapikan meja\nKonteks: Deadline besok")).toBe("Merapikan meja");
    expect(stripDeadlineLeakFromTitle("Membeli susu deadline jam 17.11")).toBe("Membeli susu");
    expect(stripDeadlineLeakFromTitle("foo Konteks: Deadline jam 16:46")).toBe("foo");
  });
});

