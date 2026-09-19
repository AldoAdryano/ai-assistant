import { describe, it, expect } from "vitest";
import { matchProject, extractProjectMention, findExactProject } from "../src/project-match";
import type { ProjectRecord } from "../src/types";

const projects: ProjectRecord[] = [
  { id: "1", name: "Persiapan IKN" },
  { id: "2", name: "Portfolio Embedded" },
  { id: "3", name: "KRTI VTOL" },
];

describe("matchProject", () => {
  it("exact case-insensitive", () => {
    expect(matchProject("persiapan ikn", projects)).toEqual({
      kind: "one",
      project: projects[0],
    });
  });
  it("unique contains", () => {
    expect(matchProject("IKN", projects).kind).toBe("one");
  });
  it("ambiguous contains", () => {
    const r = matchProject("a", [
      { id: "1", name: "Alpha" },
      { id: "2", name: "Beta" },
      { id: "3", name: "Gamma" },
    ]);
    // use query that hits 2 names:
    expect(matchProject("port", [
      { id: "1", name: "Portfolio A" },
      { id: "2", name: "Portfolio B" },
    ]).kind).toBe("ambiguous");
  });
  it("none", () => {
    expect(matchProject("Finance", projects)).toEqual({ kind: "none" });
  });
  it("empty query → none", () => {
    expect(matchProject("  ", projects)).toEqual({ kind: "none" });
  });
});

describe("extractProjectMention", () => {
  it("extracts untuk project …", () => {
    expect(extractProjectMention("buat tugas beli powerbank untuk project Liburan Mars")).toBe("Liburan Mars");
  });
  it("extracts before deadline clause", () => {
    expect(extractProjectMention("packing untuk project Persiapan IKN, deadline besok jam 8")).toBe("Persiapan IKN");
  });
  it("returns null for tanpa project", () => {
    expect(extractProjectMention("buat tugas isi bensin, tanpa project, deadline lusa")).toBeNull();
  });
  it("returns null when no mention", () => {
    expect(extractProjectMention("buat tugas laundry besok")).toBeNull();
  });
});

describe("findExactProject", () => {
  it("returns project on case-insensitive exact name", () => {
    expect(findExactProject("persiapan ikn", projects)).toEqual(projects[0]);
  });
  it("returns null when no exact match", () => {
    expect(findExactProject("IKN", projects)).toBeNull();
  });
});
