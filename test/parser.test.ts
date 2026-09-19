import { describe, expect, it } from "vitest";
import { parseDeterministicIntent } from "../src/parser";

describe("parseDeterministicIntent", () => {
  it("parses an idea note", () => {
    expect(parseDeterministicIntent("Catat ide: bahas dark pattern")).toMatchObject({ type: "ADD_NOTE", noteType: "Idea", text: "bahas dark pattern" });
  });
  it("parses a normal note", () => {
    expect(parseDeterministicIntent("Catat hubungi dosen besok")).toMatchObject({ type: "ADD_NOTE", noteType: "Note", text: "hubungi dosen besok" });
  });
  it("parses task priority and removes the priority phrase", () => {
    expect(parseDeterministicIntent("Tambah tugas cari 5 jurnal, prioritas tinggi")).toMatchObject({ type: "ADD_TASK", text: "cari 5 jurnal", priority: "High" });
  });
  it("parses an ISO task deadline", () => {
    expect(parseDeterministicIntent("Tambah tugas revisi bab 2 deadline 2026-09-03")).toMatchObject({ type: "ADD_TASK", text: "revisi bab 2", due: "2026-09-03", priority: "Medium" });
  });
  it("parses list tasks", () => {
    expect(parseDeterministicIntent("Apa tugas saya?")).toMatchObject({ type: "LIST_TASKS" });
  });
  it("parses remember key/value around 'adalah'", () => {
    expect(parseDeterministicIntent("Ingat bahwa topik utama proyek ini adalah personal AI WhatsApp")).toMatchObject({ type: "REMEMBER", key: "topik utama proyek ini", value: "personal AI WhatsApp", category: "Other" });
  });
  it("falls back to storing the whole statement when no 'adalah' exists", () => {
    expect(parseDeterministicIntent("Ingat bahwa saya suka jawaban ringkas")).toMatchObject({ type: "REMEMBER", key: "saya suka jawaban ringkas", value: "saya suka jawaban ringkas" });
  });
  it("parses recall", () => {
    expect(parseDeterministicIntent("Apa yang kamu ingat tentang topik utama?")).toMatchObject({ type: "RECALL", query: "topik utama" });
  });
  it("parses help commands", () => {
    expect(parseDeterministicIntent("bantuan")).toMatchObject({ type: "HELP" });
    expect(parseDeterministicIntent("/start")).toMatchObject({ type: "HELP" });
    expect(parseDeterministicIntent("/start referral123")).toMatchObject({ type: "HELP" });
    expect(parseDeterministicIntent("/help")).toMatchObject({ type: "HELP" });
  });
  it("returns null for normal chat", () => {
    expect(parseDeterministicIntent("Menurutmu saya mulai dari mana?")).toBeNull();
  });
});

import { normalizeTaskIntent } from "../src/parser";

describe("normalizeTaskIntent (Task 4)", () => {
  it("TEST 1: Tambah tugas membuat laporan praktikum deadline Senin", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const originalText = "Tambah tugas membuat laporan praktikum deadline Senin";
    // We mock the intent argument because normalizeTaskIntent should just trust originalText for parsing due.
    const intent: any = { type: "ADD_TASK", priority: "Medium" };
    
    const result = normalizeTaskIntent(intent, originalText, ref);
    expect(result.title).toBe("membuat laporan praktikum");
    expect(result.content).toBeUndefined();
    expect(result.due).toBe("2026-09-07");
    expect(result.deadlineParseResult.kind).toBe("resolved");
  });

  it("TEST 2: Tugas kuliah praktikum instalasi dan mesin listrik: membuat laprak pertemuan pertama, deadline hari senin depan", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const originalText = "Tugas kuliah praktikum instalasi dan mesin listrik: membuat laprak pertemuan pertama, deadline hari senin depan";
    const intent: any = { type: "ADD_TASK", priority: "Medium" };
    
    const result = normalizeTaskIntent(intent, originalText, ref);
    expect(result.title).toBe("membuat laprak pertemuan pertama");
    expect(result.content).toBe("praktikum instalasi dan mesin listrik");
    expect(result.due).toBe("2026-09-07");
    expect(result.deadlineParseResult.kind).toBe("resolved");
  });

  it("TEST 3: Tambah tugas beli kabel LAN", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const originalText = "Tambah tugas beli kabel LAN";
    const intent: any = { type: "ADD_TASK", priority: "Medium" };
    
    const result = normalizeTaskIntent(intent, originalText, ref);
    expect(result.title).toBe("beli kabel LAN");
    expect(result.content).toBeUndefined();
    expect(result.due).toBeUndefined();
    expect(result.deadlineParseResult.kind).toBe("none");
  });

  it("TEST 4: Gemini intent with long text maintains clean title", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const originalText = "Saya harus: menghubungi dosen pembimbing terkait bab 3, jatuh tempo besok";
    const intent: any = { type: "ADD_TASK", priority: "High" };
    
    const result = normalizeTaskIntent(intent, originalText, ref);
    expect(result.title).toBe("menghubungi dosen pembimbing terkait bab 3");
    expect(result.content).toBeUndefined();
    expect(result.due).toBe("2026-09-01");
    expect(result.priority).toBe("High");
  });

  it("TEST 5: Tambah tugas beli printer baru minggu depan (TANPA MARKER)", () => {
    const ref = new Date("2026-08-31T01:00:00+07:00");
    const originalText = "Tambah tugas beli printer baru minggu depan";
    const intent: any = { type: "ADD_TASK", priority: "Medium" };
    
    const result = normalizeTaskIntent(intent, originalText, ref);
    expect(result.title).toBe("beli printer baru");
    expect(result.deadlineParseResult.kind).toBe("needs_clarification");
    expect(result.deadlineParseResult.reason).toBe("missing_weekday");
  });
});
