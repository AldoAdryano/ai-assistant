import { describe, expect, it } from "vitest";
import {
  decideReflectionNudge,
  isSundayEveningWib,
  reflectionNudgeBlocked,
  reflectionNudgeText,
} from "../src/reflection-nudge";
import type { ConversationContext } from "../src/conversation-context";

const sundayEvening = new Date("2026-10-11T12:30:00Z");

function topic(currentTopic: string, updatedAt: number): ConversationContext {
  return { currentTopic, previousTopic: null, activeTaskHint: null, updatedAt };
}

describe("reflection nudge", () => {
  it("is only Sunday evening WIB", () => {
    expect(isSundayEveningWib(sundayEvening)).toBe(true);
    expect(isSundayEveningWib(new Date("2026-10-11T11:30:00Z"))).toBe(false);
    expect(isSundayEveningWib(new Date("2026-10-12T12:30:00Z"))).toBe(false);
  });

  it("stays quiet during a fresh non-review topic", () => {
    expect(reflectionNudgeBlocked([topic("resep nasi goreng", sundayEvening.getTime() - 60_000)], sundayEvening.getTime())).toBe(true);
    expect(reflectionNudgeBlocked([topic("general", sundayEvening.getTime())], sundayEvening.getTime())).toBe(false);
    expect(reflectionNudgeBlocked([topic("review minggu", sundayEvening.getTime())], sundayEvening.getTime())).toBe(false);
  });

  it("sends once when reflection is on and the chat is idle", () => {
    const send = decideReflectionNudge({
      now: sundayEvening,
      reflectionEnabled: true,
      alreadySent: false,
      contexts: [null, null],
    });
    expect(send).toEqual({ send: true, weekStart: "2026-10-05" });
    expect(reflectionNudgeText(send.weekStart)).toContain("review minggu ini");

    expect(decideReflectionNudge({
      now: sundayEvening,
      reflectionEnabled: true,
      alreadySent: true,
      contexts: [],
    }).send).toBe(false);

    expect(decideReflectionNudge({
      now: sundayEvening,
      reflectionEnabled: true,
      alreadySent: false,
      contexts: [topic("resep nasi goreng", sundayEvening.getTime())],
    }).send).toBe(false);
  });
});
