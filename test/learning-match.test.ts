import { describe, it, expect } from "vitest";
import { matchLearning, findExactLearning } from "../src/learning-match";
import type { LearningRecord } from "../src/types";

const skills: LearningRecord[] = [
  { id: "1", name: "Rust Async" },
  { id: "2", name: "TypeScript Generics" },
  { id: "3", name: "Embedded RTOS" },
];

describe("matchLearning", () => {
  it("exact case-insensitive", () => {
    expect(matchLearning("rust async", skills)).toEqual({
      kind: "one",
      skill: skills[0],
    });
  });
  it("unique contains", () => {
    expect(matchLearning("Async", skills).kind).toBe("one");
  });
  it("ambiguous contains", () => {
    expect(matchLearning("port", [
      { id: "1", name: "Portfolio A" },
      { id: "2", name: "Portfolio B" },
    ]).kind).toBe("ambiguous");
  });
  it("none", () => {
    expect(matchLearning("Finance", skills)).toEqual({ kind: "none" });
  });
  it("empty query → none", () => {
    expect(matchLearning("  ", skills)).toEqual({ kind: "none" });
  });
  it("matches by exact skill.id", () => {
    expect(matchLearning("2", skills)).toEqual({
      kind: "one",
      skill: skills[1],
    });
  });
  it("matches Notion UUID id (hyphenated or compact)", () => {
    const uuidSkills: LearningRecord[] = [
      { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "UUID Skill" },
      { id: "1", name: "Other" },
    ];
    expect(matchLearning("a1b2c3d4-e5f6-7890-abcd-ef1234567890", uuidSkills)).toEqual({
      kind: "one",
      skill: uuidSkills[0],
    });
    expect(matchLearning("a1b2c3d4e5f67890abcdef1234567890", uuidSkills)).toEqual({
      kind: "one",
      skill: uuidSkills[0],
    });
  });
});

describe("findExactLearning", () => {
  it("returns skill on case-insensitive exact name", () => {
    expect(findExactLearning("rust async", skills)).toEqual(skills[0]);
  });
  it("returns null when no exact match", () => {
    expect(findExactLearning("Async", skills)).toBeNull();
  });
});
