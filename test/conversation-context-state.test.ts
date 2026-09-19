import { describe, expect, it, vi } from "vitest";
import type { ConversationContext } from "../src/conversation-context";
import type { Env } from "../src/types";
import {
  CHAT_LOG_TTL_SECONDS,
  clearConversationContext,
  clearMemory,
  getConversationContext,
  saveConversationContext,
} from "../src/state";

function createMockKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, _opts?: { expirationTtl?: number }) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
}

const sampleContext: ConversationContext = {
  currentTopic: "belanja kaos",
  previousTopic: "drone",
  activeTaskHint: null,
  updatedAt: 1_700_000_000_000,
};

describe("conversation context KV state", () => {
  it("saveConversationContext stores JSON at conversation_context key with CHAT_LOG_TTL_SECONDS", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await saveConversationContext(env, "62812", sampleContext);

    expect(kv.put).toHaveBeenCalledWith(
      "conversation_context:62812",
      JSON.stringify(sampleContext),
      { expirationTtl: CHAT_LOG_TTL_SECONDS },
    );
    expect(kv.store.get("conversation_context:62812")).toBe(JSON.stringify(sampleContext));
  });

  it("getConversationContext returns parsed ConversationContext when present", async () => {
    const kv = createMockKv();
    kv.store.set("conversation_context:62812", JSON.stringify(sampleContext));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getConversationContext(env, "62812")).resolves.toEqual(sampleContext);
  });

  it("getConversationContext returns null when missing or invalid JSON", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getConversationContext(env, "62812")).resolves.toBeNull();

    kv.store.set("conversation_context:62812", "not-json");
    await expect(getConversationContext(env, "62812")).resolves.toBeNull();
  });

  it("clearConversationContext removes the key", async () => {
    const kv = createMockKv();
    kv.store.set("conversation_context:62812", JSON.stringify(sampleContext));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearConversationContext(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("conversation_context:62812");
    expect(kv.store.has("conversation_context:62812")).toBe(false);
  });

  it("clearMemory also clears conversation_context for the user", async () => {
    const kv = createMockKv();
    kv.store.set("interaction_id:62812", "ix-1");
    kv.store.set("chat_log:62812", "User: hi");
    kv.store.set("conversation_context:62812", JSON.stringify(sampleContext));
    kv.store.set("pending_delete:62812", JSON.stringify({ kind: "memory", ids: [], summary: "", createdAt: 0 }));
    kv.store.set("pending_memory:62812", JSON.stringify({ key: "allergies", value: "peanut", category: "Health", createdAt: 0 }));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearMemory(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("conversation_context:62812");
    expect(kv.store.has("conversation_context:62812")).toBe(false);
  });
});
