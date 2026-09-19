import { describe, it, expect } from "vitest";
import {
  selectBriefingTasks,
  selectUrgentTasks,
  mergeAlarmTaskLists,
  detectBriefingRequest,
  isDailyReminderSlot,
  BRIEFING_CAP,
} from "../src/task-intelligence";
import type { TaskRecord } from "../src/types";

function task(partial: Partial<TaskRecord> & { id: string; task: string }): TaskRecord {
  return { status: "To Do", priority: "Medium", ...partial };
}

describe("isDailyReminderSlot", () => {
  it("true at 07:00–07:09 and 18:00–18:09", () => {
    expect(isDailyReminderSlot(7, 0)).toBe(true);
    expect(isDailyReminderSlot(7, 9)).toBe(true);
    expect(isDailyReminderSlot(18, 5)).toBe(true);
    expect(isDailyReminderSlot(7, 10)).toBe(false);
    expect(isDailyReminderSlot(12, 0)).toBe(false);
  });
});

describe("selectBriefingTasks", () => {
  // Fixed instant: 2026-09-02 10:00 WIB = 03:00 UTC
  const nowMs = Date.parse("2026-09-02T03:00:00Z");

  it("includes overdue date-only, due today, datetime within 24h, High no due", () => {
    const selected = selectBriefingTasks([
      task({ id: "old", task: "Overdue", due: "2026-09-01", priority: "Low" }),
      task({ id: "today", task: "Hari ini", due: "2026-09-02", priority: "Medium" }),
      task({ id: "soon", task: "Malam ini", due: "2026-09-02T15:00:00Z", priority: "Medium" }),
      task({ id: "hi", task: "High undated", priority: "High" }),
      task({ id: "later", task: "Besok date-only", due: "2026-09-03", priority: "High" }),
      task({ id: "far", task: "Far datetime", due: "2026-09-05T03:00:00Z", priority: "High" }),
      task({ id: "med", task: "Medium undated", priority: "Medium" }),
    ], nowMs);
    const ids = selected.map((t) => t.id);
    expect(ids).toContain("old");
    expect(ids).toContain("today");
    expect(ids).toContain("soon");
    expect(ids).toContain("hi");
    expect(ids).not.toContain("later");
    expect(ids).not.toContain("far");
    expect(ids).not.toContain("med");
  });

  it("caps at BRIEFING_CAP preferring overdue first", () => {
    const many: TaskRecord[] = [];
    for (let i = 0; i < 10; i++) {
      many.push(task({ id: `o${i}`, task: `Old ${i}`, due: "2026-08-01", priority: "Low" }));
    }
    for (let i = 0; i < 5; i++) {
      many.push(task({ id: `h${i}`, task: `High ${i}`, priority: "High" }));
    }
    const selected = selectBriefingTasks(many, nowMs);
    expect(selected).toHaveLength(BRIEFING_CAP);
    expect(selected.every((t) => t.id.startsWith("o"))).toBe(true);
  });

  it("returns empty when nothing matches", () => {
    expect(selectBriefingTasks([
      task({ id: "1", task: "Later", due: "2026-09-10", priority: "Medium" }),
    ], nowMs)).toEqual([]);
  });
});

describe("selectUrgentTasks", () => {
  const nowMs = Date.parse("2026-09-02T10:00:00Z");
  it("only datetime within 60 minutes", () => {
    const selected = selectUrgentTasks([
      task({ id: "u", task: "Mepet", due: "2026-09-02T10:45:00Z", priority: "High" }),
      task({ id: "d", task: "Date only today", due: "2026-09-02", priority: "High" }),
      task({ id: "f", task: "Far", due: "2026-09-02T12:00:00Z", priority: "High" }),
    ], nowMs);
    expect(selected.map((t) => t.id)).toEqual(["u"]);
  });
});

describe("mergeAlarmTaskLists", () => {
  it("urgent first then briefing without dup ids", () => {
    const u = [task({ id: "a", task: "A", due: "2026-09-02T10:30:00Z" })];
    const b = [
      task({ id: "a", task: "A", due: "2026-09-02T10:30:00Z" }),
      task({ id: "b", task: "B", due: "2026-09-01" }),
    ];
    expect(mergeAlarmTaskLists(u, b).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("detectBriefingRequest", () => {
  it("matches known phrases", () => {
    expect(detectBriefingRequest("briefing")).toBe(true);
    expect(detectBriefingRequest("Ringkasin tugas")).toBe(true);
    expect(detectBriefingRequest("apa tugas saya?")).toBe(true);
    expect(detectBriefingRequest("tugas hari ini")).toBe(true);
  });
  it("rejects unrelated chat", () => {
    expect(detectBriefingRequest("resep ayam goreng")).toBe(false);
    expect(detectBriefingRequest("besok")).toBe(false);
  });
});
