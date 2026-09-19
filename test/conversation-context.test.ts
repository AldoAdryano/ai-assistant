import { describe, expect, it } from "vitest";
import {
  applyTopicSwitch,
  detectExplicitTopicSwitch,
  isDeadlineOnlyReply,
  type ConversationContext,
} from "../src/conversation-context";

describe("isDeadlineOnlyReply", () => {
  it("true for bare deadline/time replies", () => {
    expect(isDeadlineOnlyReply("besok")).toBe(true);
    expect(isDeadlineOnlyReply("Besok")).toBe(true);
    expect(isDeadlineOnlyReply("jam 8")).toBe(true);
    expect(isDeadlineOnlyReply("jam 8 malam")).toBe(true);
    expect(isDeadlineOnlyReply("lusa")).toBe(true);
    expect(isDeadlineOnlyReply("besok saja")).toBe(true);
    expect(isDeadlineOnlyReply("minggu depan")).toBe(true);
  });

  it("false when message has substantive content", () => {
    expect(isDeadlineOnlyReply("pindah topik belanja")).toBe(false);
    expect(isDeadlineOnlyReply("soal drone besok")).toBe(false);
    expect(isDeadlineOnlyReply("buat tugas laprak deadline besok")).toBe(false);
  });
});

describe("detectExplicitTopicSwitch", () => {
  it("detects phrase switches and extracts topic remainder", () => {
    expect(detectExplicitTopicSwitch("pindah topik belanja kaos")).toEqual({ topic: "belanja kaos" });
    expect(detectExplicitTopicSwitch("GANTI TOPIK drone")).toEqual({ topic: "drone" });
    expect(detectExplicitTopicSwitch("topik baru belanja")).toEqual({ topic: "belanja" });
    expect(detectExplicitTopicSwitch("kita bahas yang lain soal kaos")).toEqual({ topic: "soal kaos" });
    expect(detectExplicitTopicSwitch("bahas yang lain belanja")).toEqual({ topic: "belanja" });
  });

  it("uses general placeholder when no remainder", () => {
    expect(detectExplicitTopicSwitch("pindah topik")).toEqual({ topic: "general" });
    expect(detectExplicitTopicSwitch("ganti topik!")).toEqual({ topic: "general" });
  });

  it("returns null for deadline-only replies", () => {
    expect(detectExplicitTopicSwitch("besok")).toBeNull();
    expect(detectExplicitTopicSwitch("jam 8")).toBeNull();
  });

  it("returns null when no switch phrase", () => {
    expect(detectExplicitTopicSwitch("beli kaos dulu")).toBeNull();
    expect(detectExplicitTopicSwitch("")).toBeNull();
  });

  it("returns null when remainder is deadline-only", () => {
    expect(detectExplicitTopicSwitch("pindah topik besok")).toBeNull();
    expect(detectExplicitTopicSwitch("ganti topik jam 8")).toBeNull();
  });
});

describe("applyTopicSwitch", () => {
  const now = 1_700_000_000_000;

  it("creates fresh context when prev is null", () => {
    expect(applyTopicSwitch(null, "belanja kaos", now)).toEqual({
      currentTopic: "belanja kaos",
      previousTopic: null,
      activeTaskHint: null,
      updatedAt: now,
    });
  });

  it("moves old current to previous and clears activeTaskHint", () => {
    const prev: ConversationContext = {
      currentTopic: "drone",
      previousTopic: "laprak",
      activeTaskHint: "fix wiring",
      updatedAt: now - 60_000,
    };
    expect(applyTopicSwitch(prev, "belanja kaos", now)).toEqual({
      currentTopic: "belanja kaos",
      previousTopic: "drone",
      activeTaskHint: null,
      updatedAt: now,
    });
  });

  it("trims new topic", () => {
    expect(applyTopicSwitch(null, "  belanja  ", now).currentTopic).toBe("belanja");
  });

  it("returns prev unchanged when new topic matches current (case-insensitive)", () => {
    const prev: ConversationContext = {
      currentTopic: "drone FPV",
      previousTopic: "laprak",
      activeTaskHint: null,
      updatedAt: now - 60_000,
    };
    expect(applyTopicSwitch(prev, "drone fpv", now)).toBe(prev);
  });
});
