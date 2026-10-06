import { describe, expect, it } from "vitest";
import {
  PENDING_PLAN_FRESH_MS,
  isPendingPlanFresh,
  learnWindow,
  parseLearningDays,
  userMentionsPriority,
} from "../src/task-plan";

describe("parseLearningDays", () => {
  it("uses the last number directly before hari", () => {
    expect(parseLearningDays("belajar ROS dalam 30 hari")).toBe(30);
    expect(parseLearningDays("belajar MQTT 14 hari")).toBe(14);
    expect(parseLearningDays("belajar 2 jam sehari selama 30 hari")).toBe(30);
  });

  it("returns null when missing or outside 1-90", () => {
    expect(parseLearningDays("belajar ROS")).toBeNull();
    expect(parseLearningDays("belajar ROS 0 hari")).toBeNull();
    expect(parseLearningDays("belajar ROS 91 hari")).toBeNull();
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
