import { describe, expect, it } from "vitest";
import {
  asHealthKind,
  formatHealthSummary,
  formatReflectionProposal,
  normalizeEvidenceUrl,
  reflectionGaps,
} from "../src/life-log";

describe("health and career capture", () => {
  it("maps sleep and workout words onto kinds", () => {
    expect(asHealthKind("tidur")).toBe("Sleep");
    expect(asHealthKind("workout")).toBe("Workout");
    expect(asHealthKind("catatan")).toBe("Other");
  });

  it("summarizes entries and totals sleep hours", () => {
    const text = formatHealthSummary([
      { name: "strength", kind: "Workout", date: "2026-10-06" },
      { name: "tidur", kind: "Sleep", date: "2026-10-06", hours: 7 },
      { name: "tidur", kind: "Sleep", date: "2026-10-07", hours: 6 },
    ]);
    expect(text).toContain("Workout: strength");
    expect(text).toContain("Total tidur: 13 jam.");
  });

  it("accepts only http evidence links", () => {
    expect(normalizeEvidenceUrl("https://example.com/iot")).toBe("https://example.com/iot");
    expect(normalizeEvidenceUrl("portfolio iot")).toBeNull();
  });
});

describe("weekly reflection", () => {
  it("names empty sections and formats the confirm reply", () => {
    expect(reflectionGaps({ learned: "a", built: "", income: "c", timeWasted: "d", improve: "e" })).toEqual(["Built"]);
    const text = formatReflectionProposal({
      learned: "MQTT",
      built: "simulasi",
      income: "tidak ada",
      timeWasted: "scroll",
      improve: "tidur lebih awal",
      weekStart: "2026-10-05",
      createdAt: 1,
    });
    expect(text).toContain("Review minggu 2026-10-05");
    expect(text).toContain('Balas "ya" atau "jangan".');
  });
});
