import { describe, expect, it } from "vitest";
import {
  buildDeleteTitleSummary,
  filterCreateTaskCalls,
  isPendingDeleteFresh,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
  PENDING_DELETE_FRESH_MS,
  userExplicitMultiCreate,
} from "../src/action-safety";

describe("userExplicitMultiCreate", () => {
  it("false for single-topic burst text", () => {
    expect(userExplicitMultiCreate("Simurelay error lagi\ncek board\nfix wiring")).toBe(false);
  });
  it("true for explicit count", () => {
    expect(userExplicitMultiCreate("buat 3 tugas: A, B, dan C")).toBe(true);
  });
  it("true for clarify follow-ups like beberapa / pisah / banyak", () => {
    expect(userExplicitMultiCreate("beberapa")).toBe(true);
    expect(userExplicitMultiCreate("pisah")).toBe(true);
    expect(userExplicitMultiCreate("terpisah aja")).toBe(true);
    expect(userExplicitMultiCreate("banyak")).toBe(true);
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

  it("allows multi when user answers beberapa", () => {
    const r = filterCreateTaskCalls(four.slice(0, 3), "beberapa");
    expect(r.allowed).toHaveLength(3);
    expect(r.blocked).toBe(false);
  });
});

describe("delete confirm phrases", () => {
  it("detects positive short confirms", () => {
    expect(isPositiveDeleteConfirm("ya")).toBe(true);
    expect(isPositiveDeleteConfirm("yakin!")).toBe(true);
    expect(isPositiveDeleteConfirm("ok")).toBe(true);
    expect(isPositiveDeleteConfirm("oke")).toBe(true);
    expect(isPositiveDeleteConfirm("boleh")).toBe(true);
    expect(isPositiveDeleteConfirm("lanjutkan")).toBe(true);
    expect(isPositiveDeleteConfirm("ya hapus")).toBe(true);
  });

  it("does not treat bare hapus or long chat as positive", () => {
    expect(isPositiveDeleteConfirm("hapus")).toBe(false);
    expect(isPositiveDeleteConfirm("ok besok kita bahas lagi panjang")).toBe(false);
    expect(isPositiveDeleteConfirm("besok saja")).toBe(false);
  });

  it("detects negative including jangan hapus", () => {
    expect(isNegativeDeleteConfirm("jangan")).toBe(true);
    expect(isNegativeDeleteConfirm("jangan hapus")).toBe(true);
    expect(isNegativeDeleteConfirm("batal")).toBe(true);
  });
});

describe("pending delete freshness", () => {
  it("fresh within 10 minutes", () => {
    const now = 1_700_000_000_000;
    expect(
      isPendingDeleteFresh({ kind: "tasks", ids: ["1"], summary: "a", createdAt: now - 60_000 }, now),
    ).toBe(true);
  });
  it("stale after 10 minutes", () => {
    const now = 1_700_000_000_000;
    expect(
      isPendingDeleteFresh(
        { kind: "tasks", ids: ["1"], summary: "a", createdAt: now - PENDING_DELETE_FRESH_MS - 1 },
        now,
      ),
    ).toBe(false);
  });
});

describe("buildDeleteTitleSummary", () => {
  it("joins up to 3 truncated titles", () => {
    expect(buildDeleteTitleSummary(["A", "B", "C", "D"])).toBe("A, B, C");
    const long = "x".repeat(50);
    expect(buildDeleteTitleSummary([long])).toMatch(/…$/);
  });
});
