import type { PendingDelete, PendingMemory } from "./action-safety";
import type { ConversationContext } from "./conversation-context";
import type { Env, NormalizedTaskResult } from "./types";

const TTL_SECONDS = 3600;
/** Chat history must survive overnight so Youyou remembers illness / context from yesterday. */
export const CHAT_LOG_TTL_SECONDS = 7 * 24 * 3600;
/** Keep enough turns for multi-day context without blowing KV/prompt limits. */
export const CHAT_LOG_MAX_CHARS = 12000;

function getKey(userId: number | string): string {
  return `pending_task:${userId}`;
}

export async function savePendingTask(env: Env, userId: number | string, taskData: NormalizedTaskResult): Promise<void> {
  await env.DEDUP_KV.put(getKey(userId), JSON.stringify(taskData), { expirationTtl: TTL_SECONDS });
}

export async function getPendingTask(env: Env, userId: number | string): Promise<NormalizedTaskResult | null> {
  const data = await env.DEDUP_KV.get(getKey(userId));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as NormalizedTaskResult;
  } catch {
    return null;
  }
}

export async function clearPendingTask(env: Env, userId: number | string): Promise<void> {
  await env.DEDUP_KV.delete(getKey(userId));
}

function getPendingDeleteKey(userId: number | string): string {
  return `pending_delete:${userId}`;
}

export async function savePendingDelete(env: Env, userId: number | string, pending: PendingDelete): Promise<void> {
  await env.DEDUP_KV.put(getPendingDeleteKey(userId), JSON.stringify(pending), { expirationTtl: TTL_SECONDS });
}

export async function getPendingDelete(env: Env, userId: number | string): Promise<PendingDelete | null> {
  const data = await env.DEDUP_KV.get(getPendingDeleteKey(userId));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as PendingDelete;
  } catch {
    return null;
  }
}

export async function clearPendingDelete(env: Env, userId: number | string): Promise<void> {
  await env.DEDUP_KV.delete(getPendingDeleteKey(userId));
}

function getPendingMemoryKey(userId: number | string): string {
  return `pending_memory:${userId}`;
}

export async function savePendingMemory(env: Env, userId: number | string, pending: PendingMemory): Promise<void> {
  await env.DEDUP_KV.put(getPendingMemoryKey(userId), JSON.stringify(pending), { expirationTtl: TTL_SECONDS });
}

export async function getPendingMemory(env: Env, userId: number | string): Promise<PendingMemory | null> {
  const data = await env.DEDUP_KV.get(getPendingMemoryKey(userId));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as PendingMemory;
  } catch {
    return null;
  }
}

export async function clearPendingMemory(env: Env, userId: number | string): Promise<void> {
  await env.DEDUP_KV.delete(getPendingMemoryKey(userId));
}

function getInteractionKey(userId: number | string): string {
  return `interaction_id:${userId}`;
}

export async function saveInteractionId(env: Env, userId: number | string, interactionId: string): Promise<void> {
  await env.DEDUP_KV.put(getInteractionKey(userId), interactionId, { expirationTtl: TTL_SECONDS });
}

export async function getInteractionId(env: Env, userId: number | string): Promise<string | null> {
  const data = await env.DEDUP_KV.get(getInteractionKey(userId));
  return data || null;
}

function getChatLogKey(userId: number | string): string {
  return `chat_log:${userId}`;
}

export async function saveChatLog(env: Env, userId: number | string, log: string): Promise<void> {
  await env.DEDUP_KV.put(getChatLogKey(userId), log, { expirationTtl: CHAT_LOG_TTL_SECONDS });
}

export async function getChatLog(env: Env, userId: number | string): Promise<string | null> {
  const data = await env.DEDUP_KV.get(getChatLogKey(userId));
  return data || null;
}

function getConversationContextKey(userId: number | string): string {
  return `conversation_context:${userId}`;
}

export async function saveConversationContext(
  env: Env,
  userId: number | string,
  context: ConversationContext,
): Promise<void> {
  await env.DEDUP_KV.put(getConversationContextKey(userId), JSON.stringify(context), {
    expirationTtl: CHAT_LOG_TTL_SECONDS,
  });
}

export async function getConversationContext(
  env: Env,
  userId: number | string,
): Promise<ConversationContext | null> {
  const data = await env.DEDUP_KV.get(getConversationContextKey(userId));
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as ConversationContext;
  } catch {
    return null;
  }
}

export async function clearConversationContext(env: Env, userId: number | string): Promise<void> {
  await env.DEDUP_KV.delete(getConversationContextKey(userId));
}

export async function clearMemory(env: Env, userId: number | string): Promise<void> {
  await Promise.all([
    env.DEDUP_KV.delete(getInteractionKey(userId)),
    env.DEDUP_KV.delete(getChatLogKey(userId)),
    env.DEDUP_KV.delete(getConversationContextKey(userId)),
    env.DEDUP_KV.delete(getPendingDeleteKey(userId)),
    env.DEDUP_KV.delete(getPendingMemoryKey(userId)),
  ]);
}
