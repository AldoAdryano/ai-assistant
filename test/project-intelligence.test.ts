import { describe, it, expect } from "vitest";
import {
  formatProjectList,
  formatProjectStatus,
  formatTasksGroupedByProject,
} from "../src/project-intelligence";
import type { ProjectRecord, TaskRecord } from "../src/types";

function project(partial: Partial<ProjectRecord> & { id: string; name: string }): ProjectRecord {
  return { ...partial };
}

function task(partial: Partial<TaskRecord> & { id: string; task: string }): TaskRecord {
  return { status: "To Do", priority: "Medium", ...partial };
}

describe("formatProjectList", () => {
  it("returns empty copy when no projects", () => {
    expect(formatProjectList([])).toBe("Belum ada project di LIFE OS.");
  });

  it("formats name always and omits missing optional fields", () => {
    const lines = formatProjectList([
      project({
        id: "1",
        name: "Smart Room Monitor",
        area: "IoT",
        goalName: "Menguasai Embedded + IoT",
        status: "In progress",
        deadline: "2026-12-01",
      }),
      project({ id: "2", name: "Portfolio" }),
    ]).split("\n");

    expect(lines[0]).toBe(
      "• Smart Room Monitor — Area: IoT; Goal: Menguasai Embedded + IoT; Status: In progress; Deadline: 2026-12-01",
    );
    expect(lines[1]).toBe("• Portfolio");
  });

  it("omits null/empty optional meta fields", () => {
    const line = formatProjectList([
      project({
        id: "1",
        name: "Solo",
        area: null,
        goalName: "",
        status: null,
        deadline: undefined,
      }),
    ]);
    expect(line).toBe("• Solo");
  });
});

describe("formatProjectStatus", () => {
  it("header with name and optional meta, no open tasks", () => {
    const text = formatProjectStatus(
      project({
        id: "1",
        name: "Smart Room Monitor",
        area: "IoT",
        status: "In progress",
        deadline: "2026-12-01",
        goalName: "Menguasai Embedded + IoT",
      }),
      [],
    );
    expect(text).toBe(
      [
        "Smart Room Monitor — Area: IoT; Status: In progress; Deadline: 2026-12-01; Goal: Menguasai Embedded + IoT",
        "Tidak ada task terbuka.",
      ].join("\n"),
    );
  });

  it("lists open tasks with priority and optional due", () => {
    const text = formatProjectStatus(
      project({ id: "1", name: "Portfolio" }),
      [
        task({ id: "t1", task: "Wire sensor", priority: "High", due: "2026-10-01" }),
        task({ id: "t2", task: "Write README", priority: "Low" }),
      ],
    );
    expect(text).toBe(
      [
        "Portfolio",
        "Task terbuka:",
        "- [High] Wire sensor — 2026-10-01",
        "- [Low] Write README",
      ].join("\n"),
    );
  });

  it("does not filter Done — caller owns that; still formats whatever is passed", () => {
    const text = formatProjectStatus(
      project({ id: "1", name: "X" }),
      [task({ id: "d", task: "Finished", status: "Done", priority: "Medium" })],
    );
    expect(text).toContain("- [Medium] Finished");
    expect(text).toContain("Task terbuka:");
  });
});

describe("formatTasksGroupedByProject", () => {
  it("groups by trimmed projectName, sorts named groups, Tanpa project last", () => {
    const text = formatTasksGroupedByProject([
      task({ id: "1", task: "task C", projectName: null }),
      task({ id: "2", task: "task A", projectName: "Smart Room Monitor", due: "2026-09-20" }),
      task({ id: "3", task: "task B", projectName: "Smart Room Monitor" }),
      task({ id: "4", task: "orphan", projectName: "  " }),
      task({ id: "5", task: "zeta first", projectName: "Zulu" }),
      task({ id: "6", task: "alpha", projectName: "Alpha" }),
    ]);

    expect(text).toBe(
      [
        "## Alpha",
        "- alpha",
        "## Smart Room Monitor",
        "- task A (Jatuh tempo: 2026-09-20)",
        "- task B",
        "## Zulu",
        "- zeta first",
        "## Tanpa project",
        "- task C",
        "- orphan",
      ].join("\n"),
    );
  });

  it("returns empty string for empty input", () => {
    expect(formatTasksGroupedByProject([])).toBe("");
  });

  it("preserves input order within a group", () => {
    const text = formatTasksGroupedByProject([
      task({ id: "1", task: "second", projectName: "P" }),
      task({ id: "2", task: "first", projectName: "P" }),
    ]);
    // Input order: second then first — preserve that
    expect(text).toBe(["## P", "- second", "- first"].join("\n"));
  });
});
