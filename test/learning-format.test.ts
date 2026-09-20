import { describe, expect, it } from "vitest";
import { formatLearningList } from "../src/learning-format";
import type { LearningRecord } from "../src/types";

describe("formatLearningList", () => {
  it("returns empty copy when no skills", () => {
    expect(formatLearningList([])).toBe("Belum ada skill di Learning.");
  });

  it("formats name with Area, Level, Status and omits missing", () => {
    const skills: LearningRecord[] = [
      {
        id: "l1",
        name: "MQTT",
        area: "Embedded",
        level: 2,
        status: "In progress",
      },
      { id: "l2", name: "Python" },
      { id: "l3", name: "Rust", area: "Systems", status: "Not started" },
    ];
    expect(formatLearningList(skills)).toBe(
      [
        "• MQTT — Area: Embedded; Level: 2; Status: In progress",
        "• Python",
        "• Rust — Area: Systems; Status: Not started",
      ].join("\n"),
    );
  });
});
