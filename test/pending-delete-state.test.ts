import { describe, expect, it, vi } from "vitest";
import type { PendingDelete } from "../src/action-safety";
import type { Env } from "../src/types";
import {
  clearMemory,
  clearPendingDelete,
  getPendingDelete,
  savePendingDelete,
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

const samplePending: PendingDelete = {
  kind: "tasks",
  ids: ["task-1", "task-2"],
  summary: "2 tugas",
  createdAt: 1_700_000_000_000,
};

describe("pending delete KV state", () => {
  it("savePendingDelete stores JSON at pending_delete key with 3600s TTL", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await savePendingDelete(env, "62812", samplePending);

    expect(kv.put).toHaveBeenCalledWith(
      "pending_delete:62812",
      JSON.stringify(samplePending),
      { expirationTtl: 3600 },
    );
    expect(kv.store.get("pending_delete:62812")).toBe(JSON.stringify(samplePending));
  });

  it("getPendingDelete returns parsed PendingDelete when present", async () => {
    const kv = createMockKv();
    kv.store.set("pending_delete:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getPendingDelete(env, "62812")).resolves.toEqual(samplePending);
  });

  it("getPendingDelete returns null when missing or invalid JSON", async () => {
    const kv = createMockKv();
    const env = { DEDUP_KV: kv } as unknown as Env;

    await expect(getPendingDelete(env, "62812")).resolves.toBeNull();

    kv.store.set("pending_delete:62812", "not-json");
    await expect(getPendingDelete(env, "62812")).resolves.toBeNull();
  });

  it("clearPendingDelete removes the key", async () => {
    const kv = createMockKv();
    kv.store.set("pending_delete:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearPendingDelete(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("pending_delete:62812");
    expect(kv.store.has("pending_delete:62812")).toBe(false);
  });

  it("clearMemory also clears pending_delete for the user", async () => {
    const kv = createMockKv();
    kv.store.set("interaction_id:62812", "ix-1");
    kv.store.set("chat_log:62812", "User: hi");
    kv.store.set("pending_delete:62812", JSON.stringify(samplePending));
    const env = { DEDUP_KV: kv } as unknown as Env;

    await clearMemory(env, "62812");

    expect(kv.delete).toHaveBeenCalledWith("interaction_id:62812");
    expect(kv.delete).toHaveBeenCalledWith("chat_log:62812");
    expect(kv.delete).toHaveBeenCalledWith("pending_delete:62812");
    expect(kv.store.has("pending_delete:62812")).toBe(false);
  });
});
