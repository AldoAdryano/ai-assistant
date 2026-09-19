import { describe, expect, it, vi } from "vitest";
import type { PendingMemory } from "../src/action-safety";
import type { Env } from "../src/types";
import {
  clearMemory,
  clearPendingMemory,
  getPendingMemory,
  savePendingMemory,
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

const samplePending: PendingMemory = {
  key: "allergies",
  value: "peanut",
  category: "Health",
  createdAt: 1_700_000_000_000,
};

describe("pending memory KV state", () => {
  it("savePendingMemory stores JSON at pending_memory key with 3600s TTL", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await savePendingMemory(env, "62812", samplePending);

    expect(kv.put).toHaveBeenCalledWith(
      "pending_memory:62812",
      JSON.stringify(samplePending),
      { expirationTtl: 3600 },
    );
    expect(kv.store.get("pending_memory:62812")).toBe(JSON.stringify(samplePending));
  });

  it("getPendingMemory returns parsed PendingMemory when present", async () => {
    const kv = createMockKv();
    kv.store.set("pending_memory:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getPendingMemory(env, "62812")).resolves.toEqual(samplePending);
  });

  it("getPendingMemory returns null when missing or invalid JSON", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getPendingMemory(env, "62812")).resolves.toBeNull();

    kv.store.set("pending_memory:62812", "not-json");
    await expect(getPendingMemory(env, "62812")).resolves.toBeNull();
  });

  it("clearPendingMemory removes the key", async () => {
    const kv = createMockKv();
    kv.store.set("pending_memory:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearPendingMemory(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("pending_memory:62812");
    expect(kv.store.has("pending_memory:62812")).toBe(false);
  });

  it("clearMemory also clears pending_memory for the user", async () => {
    const kv = createMockKv();
    kv.store.set("interaction_id:62812", "ix-1");
    kv.store.set("chat_log:62812", "User: hi");
    kv.store.set("pending_delete:62812", JSON.stringify({ kind: "memory", ids: [], summary: "", createdAt: 0 }));
    kv.store.set("pending_memory:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearMemory(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("interaction_id:62812");
    expect(kv.delete).toHaveBeenCalledWith("chat_log:62812");
    expect(kv.delete).toHaveBeenCalledWith("pending_delete:62812");
    expect(kv.delete).toHaveBeenCalledWith("pending_memory:62812");
    expect(kv.store.has("pending_memory:62812")).toBe(false);
  });
});
