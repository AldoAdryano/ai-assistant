import { describe, expect, it } from "vitest";
import {
  filterCreateTaskCalls,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
  userExplicitMultiCreate,
} from "../src/action-safety";

describe("userExplicitMultiCreate", () => {
  it("false for single-topic burst text", () => {
    expect(userExplicitMultiCreate("Simurelay error lagi\ncek board\nfix wiring")).toBe(false);
  });
  it("true for explicit count", () => {
    expect(userExplicitMultiCreate("buat 3 tugas: A, B, dan C")).toBe(true);
  });
});

describe("filterCreateTaskCalls", () => {
  const four = [1, 2, 3, 4].map((i) => ({
    name: "create_notion_task",
    args: { title: `Tugas ${i}` },
  }));

  it("blocks multi-create without explicit signal", () => {
    const r = filterCreateTaskCalls(four, "soal Simurelay ini itu");
    expect(r.allowed).toHaveLength(0);
    expect(r.blocked).toBe(true);
    expect(r.clarifyMessage).toMatch(/satu|beberapa/i);
  });

  it("allows single create", () => {
    const r = filterCreateTaskCalls([four[0]], "buat tugas laprak deadline besok");
    expect(r.allowed).toHaveLength(1);
    expect(r.blocked).toBe(false);
  });

  it("allows multi when explicit", () => {
    const r = filterCreateTaskCalls(four.slice(0, 3), "buat 3 tugas: A, B, C");
    expect(r.allowed).toHaveLength(3);
    expect(r.blocked).toBe(false);
  });
});

describe("delete confirm phrases", () => {
  it("detects positive and negative", () => {
    expect(isPositiveDeleteConfirm("ya hapus")).toBe(true);
    expect(isNegativeDeleteConfirm("jangan")).toBe(true);
    expect(isPositiveDeleteConfirm("besok saja")).toBe(false);
  });
});
