import { describe, expect, it } from "vitest";
import type { TaskRecord } from "../src/types";
import {
  PENDING_PLAN_FRESH_MS,
  formatPlanReply,
  isPendingPlanFresh,
  learnWindow,
  parseLearningDays,
  userMentionsPriority,
  validateLearnPlan,
  validateWeekPlan,
} from "../src/task-plan";

const now = new Date("2026-10-06T10:00:00+07:00");
const tasks: TaskRecord[] = [
  { id: "t1", task: "Revisi bab 2", status: "To Do", priority: "Medium", due: "2026-10-10" },
  { id: "t2", task: "Selesai", status: "Done", priority: "Low" },
];

describe("parseLearningDays", () => {
  it("uses the last number directly before hari", () => {
    expect(parseLearningDays("belajar ROS dalam 30 hari")).toBe(30);
    expect(parseLearningDays("belajar MQTT 14 hari")).toBe(14);
    expect(parseLearningDays("belajar 2 jam sehari selama 30 hari")).toBe(30);
    expect(parseLearningDays("belajar 1 hari")).toBe(1);
    expect(parseLearningDays("belajar 90 hari")).toBe(90);
  });

  it("returns null when missing or outside 1-90", () => {
    expect(parseLearningDays("belajar ROS")).toBeNull();
    expect(parseLearningDays("belajar ROS 0 hari")).toBeNull();
    expect(parseLearningDays("belajar ROS 91 hari")).toBeNull();
    expect(parseLearningDays("belajar 1030 hari")).toBeNull();
  });
});

describe("learnWindow", () => {
  it("is inclusive from today through today plus N-1 in WIB", () => {
    const now = new Date("2026-10-06T10:00:00+07:00");
    expect(learnWindow(now, 1)).toEqual({ startDate: "2026-10-06", endDate: "2026-10-06" });
    expect(learnWindow(now, 30)).toEqual({ startDate: "2026-10-06", endDate: "2026-11-04" });
  });
});

describe("userMentionsPriority", () => {
  it("matches only the spec priority words", () => {
    expect(userMentionsPriority("atur tugas, prioritas tinggi")).toBe(true);
    expect(userMentionsPriority("priority low please")).toBe(true);
    expect(userMentionsPriority("sedang belajar")).toBe(true);
    expect(userMentionsPriority("atur tugas minggu ini")).toBe(false);
  });
});

describe("validateWeekPlan and formatPlanReply", () => {
  it("keeps in-week updates and drops creates, unknown ids, and outside dates", () => {
    const result = validateWeekPlan("atur tugas minggu ini", tasks, [
      { op: "update", taskId: "t1", due_date: "2026-10-08", priority: "High" },
      { op: "update", taskId: "nope", due_date: "2026-10-08" },
      { op: "update", taskId: "t1", due_date: "2026-10-20" },
      { op: "create", title: "Baru", due_date: "2026-10-07" },
    ], now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.kind).toBe("week");
    expect(result.plan.ops).toEqual([
      { op: "update", taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" },
    ]);
  });

  it("keeps a lowercase model priority when the user mentioned one", () => {
    const result = validateWeekPlan("atur tugas minggu ini, prioritas tinggi", tasks, [
      { op: "update", taskId: "t1", due_date: "2026-10-08", priority: "high" },
    ], now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.ops[0]).toEqual({
      op: "update",
      taskId: "t1",
      title: "Revisi bab 2",
      due_date: "2026-10-08",
      priority: "High",
    });
  });

  it("refuses a week plan when nothing valid remains", () => {
    const result = validateWeekPlan("atur tugas minggu ini", [], [
      { op: "update", taskId: "t1", due_date: "2026-10-08" },
    ], now);
    expect(result).toEqual({ ok: false, message: "Tidak ada tugas aktif untuk diatur minggu ini." });
  });

  it("formats the old due and asks for ya or jangan", () => {
    const plan = {
      kind: "week" as const,
      createdAt: 1,
      ops: [{ op: "update" as const, taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
    };
    const text = formatPlanReply(plan, [], tasks);
    expect(text).toContain("1. Revisi bab 2 — 2026-10-08 (sebelumnya 2026-10-10)");
    expect(text).toContain('Balas "ya" atau "jangan".');
  });
});

describe("validateLearnPlan", () => {
  it("asks for a day count and does not build a plan", () => {
    expect(validateLearnPlan("saya ingin belajar ROS", tasks, [
      { op: "create", title: "ROS basics", due_date: "2026-10-06" },
    ], now)).toEqual({
      ok: false,
      message: "Berapa hari? Sebut jumlahnya, misalnya 30 hari.",
    });
    expect(validateLearnPlan("belajar ROS 91 hari", tasks, [], now).ok).toBe(false);
  });

  it("caps at 8 creates, skips duplicates and updates, and defaults priority", () => {
    const ops = [
      { op: "update", taskId: "t1", due_date: "2026-10-07" },
      { op: "create", title: " Revisi bab 2 ", due_date: "2026-10-06" },
      ...Array.from({ length: 9 }, (_, i) => ({
        op: "create",
        title: `Langkah ${i + 1}`,
        due_date: "2026-10-06",
      })),
    ];
    const result = validateLearnPlan("belajar ROS dalam 30 hari", tasks, ops, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.ops).toHaveLength(8);
    expect(result.plan.ops[0]).toEqual({
      op: "create",
      title: "Langkah 1",
      due_date: "2026-10-06",
      priority: "Medium",
    });
    expect(result.notices.join(" ")).toContain("1 usulan dipotong karena batas 8 tugas.");
    expect(result.notices.join(" ")).toContain("Revisi bab 2");
  });

  it("drops learn dates outside the window and does not save a duplicate-only plan", () => {
    expect(validateLearnPlan("belajar ROS dalam 1 hari", tasks, [
      { op: "create", title: "Besok", due_date: "2026-10-07" },
    ], now).ok).toBe(false);
    const dup = validateLearnPlan("belajar ROS dalam 30 hari", tasks, [
      { op: "create", title: "revisi bab 2", due_date: "2026-10-06" },
    ], now);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.message).toContain("Revisi bab 2");
  });
});

describe("isPendingPlanFresh", () => {
  const plan = {
    kind: "week" as const,
    ops: [],
    createdAt: 1_000_000,
  };

  it("is fresh inside 30 minutes and stale after", () => {
    expect(isPendingPlanFresh(plan, plan.createdAt + PENDING_PLAN_FRESH_MS)).toBe(true);
    expect(isPendingPlanFresh(plan, plan.createdAt + PENDING_PLAN_FRESH_MS + 1)).toBe(false);
  });
});
