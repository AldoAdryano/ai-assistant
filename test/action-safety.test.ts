import { describe, expect, it } from "vitest";
import {
  buildDeleteTitleSummary,
  filterCreateTaskCalls,
  formatMemoryPropose,
  isPendingDeleteFresh,
  isPendingMemoryFresh,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
  PENDING_DELETE_FRESH_MS,
  shouldConfirmMemoryWrite,
  userExplicitMultiCreate,
  userExplicitRemember,
  userMentionsDeadline,
  stripInventedDueDate,
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
    expect(isPositiveDeleteConfirm("iya")).toBe(true);
    expect(isPositiveDeleteConfirm("Iyalah")).toBe(true);
    expect(isPositiveDeleteConfirm("iyah")).toBe(true);
    expect(isPositiveDeleteConfirm("yoi")).toBe(true);
    expect(isPositiveDeleteConfirm("sip")).toBe(true);
    expect(isPositiveDeleteConfirm("setuju")).toBe(true);
    expect(isPositiveDeleteConfirm("gas")).toBe(true);
    expect(isPositiveDeleteConfirm("yakin!")).toBe(true);
    expect(isPositiveDeleteConfirm("ok")).toBe(true);
    expect(isPositiveDeleteConfirm("oke")).toBe(true);
    expect(isPositiveDeleteConfirm("boleh")).toBe(true);
    expect(isPositiveDeleteConfirm("lanjutkan")).toBe(true);
    expect(isPositiveDeleteConfirm("ya hapus")).toBe(true);
    expect(isPositiveDeleteConfirm("iya boleh")).toBe(true);
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

describe("userMentionsDeadline / stripInventedDueDate", () => {
  it("detects deadline phrases in user text", () => {
    expect(userMentionsDeadline("buat tugas laprak deadline besok")).toBe(true);
    expect(userMentionsDeadline("simurelay instal di hp buat laporan")).toBe(false);
  });

  it("strips due when user never mentioned a date", () => {
    const call = {
      name: "create_notion_task",
      args: { title: "Simurelay", priority: "High", due_date: "2026-09-22", content: "detail" },
    };
    const r = stripInventedDueDate(call, "coba aplikasi simurelay\nbuat instalasi");
    expect(r.stripped).toBe(true);
    expect(r.call.args.due_date).toBeUndefined();
    expect(r.call.args.content).toBe("detail");
  });

  it("keeps due when user said besok", () => {
    const call = {
      name: "create_notion_task",
      args: { title: "Laprak", priority: "High", due_date: "besok" },
    };
    const r = stripInventedDueDate(call, "buat tugas laprak deadline besok");
    expect(r.stripped).toBe(false);
    expect(r.call.args.due_date).toBe("besok");
  });
});

describe("userExplicitRemember", () => {
  it("explicit remember phrases", () => {
    expect(userExplicitRemember("Ingat bahwa kuliah saya di UNY")).toBe(true);
    expect(userExplicitRemember("ingat ya aku suka jawaban singkat")).toBe(true);
    expect(userExplicitRemember("oiya inget ya bahwa aku kuliah di UNY")).toBe(true);
    expect(userExplicitRemember("Inget juga aku di prodi Pendidikan Teknik Elektronika")).toBe(true);
    expect(userExplicitRemember("inget bahwa kampus UNY")).toBe(true);
    expect(userExplicitRemember("simpan preferensi bahasa Indonesia")).toBe(true);
    expect(userExplicitRemember("simpan memori kampus UNY")).toBe(true);
    expect(userExplicitRemember("catat di memori proyek Werkudhara")).toBe(true);
    expect(userExplicitRemember("remember that I study at UNY")).toBe(true);
    expect(userExplicitRemember("aku kuliah di UNY")).toBe(false);
    expect(userExplicitRemember("kuliah saya di UNY")).toBe(false);
  });
});

describe("shouldConfirmMemoryWrite", () => {
  it("Pattern always confirms", () => {
    expect(
      shouldConfirmMemoryWrite({ userText: "ingat bahwa saya sering menunda", category: "Pattern" }),
    ).toBe(true);
  });

  it("explicit non-Pattern skips confirm", () => {
    expect(shouldConfirmMemoryWrite({ userText: "ingat bahwa kuliah UNY", category: "Identity" })).toBe(
      false,
    );
  });

  it("inferred non-Pattern requires confirm", () => {
    expect(shouldConfirmMemoryWrite({ userText: "kuliah saya di UNY", category: "Identity" })).toBe(true);
    expect(shouldConfirmMemoryWrite({ userText: "aku suka jawaban singkat", category: "Preference" })).toBe(
      true,
    );
  });
});

describe("formatMemoryPropose", () => {
  it("proposes memory in Indonesian with ya/jangan", () => {
    const msg = formatMemoryPropose({
      key: "universitas",
      value: "UNY",
      category: "Identity",
      createdAt: Date.now(),
    });
    expect(msg).toMatch(/universitas/i);
    expect(msg).toMatch(/UNY/);
    expect(msg).toMatch(/ya/i);
    expect(msg).toMatch(/jangan/i);
  });
});

describe("pending memory freshness", () => {
  it("fresh within 10 minutes", () => {
    const now = 1_700_000_000_000;
    expect(
      isPendingMemoryFresh(
        { key: "kampus", value: "UNY", category: "Identity", createdAt: now - 60_000 },
        now,
      ),
    ).toBe(true);
  });

  it("stale after 10 minutes", () => {
    const now = 1_700_000_000_000;
    expect(
      isPendingMemoryFresh(
        {
          key: "kampus",
          value: "UNY",
          category: "Identity",
          createdAt: now - PENDING_DELETE_FRESH_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });
});
