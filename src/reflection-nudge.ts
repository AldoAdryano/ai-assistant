import type { ConversationContext } from "./conversation-context";
import { currentWibWeekRange } from "./date";

export const REFLECTION_NUDGE_QUIET_MS = 2 * 60 * 60 * 1000;

export function isSundayEveningWib(now: Date): boolean {
  const wib = new Date(now.getTime() + 7 * 3600000);
  return wib.getUTCDay() === 0 && wib.getUTCHours() >= 19 && wib.getUTCHours() < 22;
}

export function reflectionNudgeBlocked(
  contexts: Array<ConversationContext | null>,
  nowMs: number,
): boolean {
  return contexts.some((ctx) => {
    if (!ctx) return false;
    const topic = ctx.currentTopic.trim().toLowerCase();
    if (!topic || topic === "general") return false;
    if (/\b(review|refleksi)\b/.test(topic)) return false;
    return nowMs - ctx.updatedAt < REFLECTION_NUDGE_QUIET_MS;
  });
}

export function reflectionNudgeText(weekStart: string): string {
  return `Minggu ${weekStart} belum direview. Kalau sempat, bilang "review minggu ini".`;
}

export function decideReflectionNudge(input: {
  now: Date;
  reflectionEnabled: boolean;
  alreadySent: boolean;
  contexts: Array<ConversationContext | null>;
}): { send: boolean; weekStart: string } {
  const weekStart = currentWibWeekRange(input.now).startDate;
  if (!input.reflectionEnabled || input.alreadySent || !isSundayEveningWib(input.now)) {
    return { send: false, weekStart };
  }
  if (reflectionNudgeBlocked(input.contexts, input.now.getTime())) {
    return { send: false, weekStart };
  }
  return { send: true, weekStart };
}
