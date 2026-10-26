import { describe, expect, it } from "vitest";
import { applyBrainPolish, looksLikeAmbiguousStrategy, looksLikeNewProject } from "../src/brain-polish";

describe("looksLikeNewProject", () => {
  it("treats a named build as a project", () => {
    expect(looksLikeNewProject("Mau bikin Smart Room Monitor")).toBe(true);
  });

  it("leaves scheduled work and explicit tasks alone", () => {
    expect(looksLikeNewProject("jadwalkan gym besok")).toBe(false);
    expect(looksLikeNewProject("buat tugas laprak deadline besok")).toBe(false);
    expect(looksLikeNewProject("mau bikin stiker")).toBe(false);
    expect(looksLikeNewProject("pengen bikin resep nasi goreng")).toBe(false);
  });
});

describe("looksLikeAmbiguousStrategy", () => {
  it("matches an unscoped strategy question", () => {
    expect(looksLikeAmbiguousStrategy("gimana strategi minggu ini")).toBe(true);
    expect(looksLikeAmbiguousStrategy("harusnya ngapain dulu soal karier")).toBe(true);
  });

  it("does not steal a concrete task", () => {
    expect(looksLikeAmbiguousStrategy("buat tugas laprak deadline besok")).toBe(false);
    expect(looksLikeAmbiguousStrategy("Mau bikin Smart Room Monitor")).toBe(false);
  });
});

describe("applyBrainPolish", () => {
  const tasks = [1, 2, 3, 4].map((i) => ({ name: "create_notion_task", args: { title: `Langkah ${i}` } }));

  it("drops a task burst for a new project and asks once", () => {
    const result = applyBrainPolish(tasks, "Mau bikin Smart Room Monitor");
    expect(result.allowed).toHaveLength(0);
    expect(result.clarifyMessage).toMatch(/project/i);
  });

  it("keeps a project create and drops the extra tasks", () => {
    const result = applyBrainPolish(
      [{ name: "create_notion_project", args: { name: "Smart Room Monitor" } }, ...tasks.slice(0, 2)],
      "Mau bikin Smart Room Monitor",
    );
    expect(result.allowed.map((call) => call.name)).toEqual(["create_notion_project"]);
    expect(result.clarifyMessage).toBeUndefined();
  });

  it("drops strategy tasks unless a note is already there", () => {
    const blocked = applyBrainPolish(tasks.slice(0, 3), "gimana strategi minggu ini");
    expect(blocked.allowed).toHaveLength(0);
    expect(blocked.clarifyMessage).toMatch(/Inbox/);

    const noted = applyBrainPolish(
      [{ name: "create_notion_note", args: { text: "arah karier" } }, tasks[0]!],
      "gimana strategi minggu ini",
    );
    expect(noted.allowed.map((call) => call.name)).toEqual(["create_notion_note"]);
    expect(noted.clarifyMessage).toBeUndefined();
  });

  it("leaves an ordinary single task to the existing guard", () => {
    const result = applyBrainPolish(tasks.slice(0, 1), "buat tugas laprak deadline besok");
    expect(result.handled).toBe(false);
    expect(result.allowed).toHaveLength(1);
  });
});
