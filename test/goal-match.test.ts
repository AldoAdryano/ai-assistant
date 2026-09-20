import { describe, it, expect } from "vitest";
import { matchGoal, findExactGoal } from "../src/goal-match";
import type { GoalRecord } from "../src/types";

const goals: GoalRecord[] = [
  { id: "1", name: "Persiapan IKN" },
  { id: "2", name: "Portfolio Embedded" },
  { id: "3", name: "KRTI VTOL" },
];

describe("matchGoal", () => {
  it("exact case-insensitive", () => {
    expect(matchGoal("persiapan ikn", goals)).toEqual({
      kind: "one",
      goal: goals[0],
    });
  });
  it("unique contains", () => {
    expect(matchGoal("IKN", goals).kind).toBe("one");
  });
  it("ambiguous contains", () => {
    expect(matchGoal("port", [
      { id: "1", name: "Portfolio A" },
      { id: "2", name: "Portfolio B" },
    ]).kind).toBe("ambiguous");
  });
  it("none", () => {
    expect(matchGoal("Finance", goals)).toEqual({ kind: "none" });
  });
  it("empty query → none", () => {
    expect(matchGoal("  ", goals)).toEqual({ kind: "none" });
  });
  it("matches by exact goal.id", () => {
    expect(matchGoal("2", goals)).toEqual({
      kind: "one",
      goal: goals[1],
    });
  });
  it("matches Notion UUID id (hyphenated or compact)", () => {
    const uuidGoals: GoalRecord[] = [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "UUID Goal" },
      { id: "1", name: "Other" },
    ];
    expect(matchGoal("a1b2c3d4-e5f6-7890-abcd-ef1234567890", uuidGoals)).toEqual({
      kind: "one",
      goal: uuidGoals[0],
    });
    expect(matchGoal("a1b2c3d4e5f67890abcdef1234567890", uuidGoals)).toEqual({
      kind: "one",
      goal: uuidGoals[0],
    });
  });
});

describe("findExactGoal", () => {
  it("returns goal on case-insensitive exact name", () => {
    expect(findExactGoal("persiapan ikn", goals)).toEqual(goals[0]);
  });
  it("returns null when no exact match", () => {
    expect(findExactGoal("IKN", goals)).toBeNull();
  });
});
