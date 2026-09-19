export type ConversationContext = {
  currentTopic: string;
  previousTopic: string | null;
  activeTaskHint: string | null;
  updatedAt: number;
};

const SWITCH_PHRASES: RegExp[] = [
  /\bkita bahas yang lain\b/i,
  /\bbahas yang lain\b/i,
  /\bpindah topik\b/i,
  /\bganti topik\b/i,
  /\btopik baru\b/i,
];

const DEADLINE_ONLY =
  /^(?:besok(?:\s+(?:saja|aja|deh))?|lusa|kemarin|hari\s+ini|nanti(?:\s+(?:saja|aja|deh))?|jam\s+\d{1,2}(?::\d{2})?(?:\s*(?:pag|siang|sore|malam|wib|am|pm))?|(?:senin|selasa|rabu|kamis|jumat|jum'?at|sabtu|minggu)(?:\s+depan)?)(?:[\s!.?,]*)?$/i;

const DEFAULT_TOPIC = "general";

function trimRemainder(text: string): string {
  return text
    .replace(/^[\s:,.!?-]+/, "")
    .replace(/[\s:,.!?-]+$/, "")
    .trim();
}

export function isDeadlineOnlyReply(userText: string): boolean {
  return DEADLINE_ONLY.test(userText.trim());
}

export function detectExplicitTopicSwitch(userText: string): { topic: string } | null {
  const text = userText.trim();
  if (!text || isDeadlineOnlyReply(text)) {
    return null;
  }

  for (const pattern of SWITCH_PHRASES) {
    const match = text.match(pattern);
    if (!match || match.index === undefined) {
      continue;
    }

    const remainder = trimRemainder(text.slice(match.index + match[0].length));
    if (remainder && isDeadlineOnlyReply(remainder)) {
      return null;
    }

    return { topic: remainder || DEFAULT_TOPIC };
  }

  return null;
}

export function applyTopicSwitch(
  prev: ConversationContext | null,
  newTopic: string,
  now = Date.now(),
): ConversationContext {
  const trimmed = newTopic.trim();
  if (prev && prev.currentTopic.trim().toLowerCase() === trimmed.toLowerCase()) {
    return prev;
  }
  return {
    currentTopic: trimmed,
    previousTopic: prev?.currentTopic ?? null,
    activeTaskHint: null,
    updatedAt: now,
  };
}
