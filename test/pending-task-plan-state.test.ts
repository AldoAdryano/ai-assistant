import { expect, it, vi } from "vitest";
import type { Env } from "../src/types";
import { clearMemory, clearPendingTaskPlan, getPendingTaskPlan, savePendingTaskPlan } from "../src/state";
import type { PendingTaskPlan } from "../src/task-plan";

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

const sample: PendingTaskPlan = {
  kind: "week",
  ops: [{ op: "update", taskId: "t1", title: "Revisi bab 2", due_date: "2026-10-08" }],
  createdAt: 1_700_000_000_000,
};

it("stores JSON at pending_task_plan with 3600s TTL", async () => {
  const kv = createMockKv();
  const env = { DEDUP_KV: kv } as unknown as Env;
  await savePendingTaskPlan(env, "62812", sample);
  expect(kv.put).toHaveBeenCalledWith(
    "pending_task_plan:62812",
    JSON.stringify(sample),
    { expirationTtl: 3600 },
  );
});

it("returns null for missing or invalid JSON and clear deletes the key", async () => {
  const kv = createMockKv();
  const env = { DEDUP_KV: kv } as unknown as Env;
  await expect(getPendingTaskPlan(env, "62812")).resolves.toBeNull();
  kv.store.set("pending_task_plan:62812", "not-json");
  await expect(getPendingTaskPlan(env, "62812")).resolves.toBeNull();
  kv.store.set("pending_task_plan:62812", JSON.stringify(sample));
  await clearPendingTaskPlan(env, "62812");
  expect(kv.store.has("pending_task_plan:62812")).toBe(false);
});

it("clearMemory also removes pending_task_plan", async () => {
  const kv = createMockKv();
  kv.store.set("pending_task_plan:62812", JSON.stringify(sample));
  const env = { DEDUP_KV: kv } as unknown as Env;
  await clearMemory(env, "62812");
  expect(kv.store.has("pending_task_plan:62812")).toBe(false);
});
