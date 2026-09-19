import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;
type WorkerRequest = Parameters<NonNullable<typeof worker.fetch>>[0];

function workerRequest(input: string, init?: RequestInit): WorkerRequest {
  return new Request(input, init) as unknown as WorkerRequest;
}

describe("health endpoint", () => {
  it("returns a minimal JSON health response", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/health"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for unknown paths", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/not-found"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});
