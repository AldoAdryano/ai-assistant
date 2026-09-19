import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createWorker, type WorkerDeps } from "../src/index";
import type { Env } from "../src/types";

const testEnv = env as unknown as Env;
type WorkerRequest = Parameters<NonNullable<ReturnType<typeof createWorker>["fetch"]>>[0];

function workerRequest(input: string, init?: RequestInit): WorkerRequest {
  return new Request(input, init) as unknown as WorkerRequest;
}

function postWithSecret(payload: unknown, secret: string | null = "test_webhook_secret_123"): WorkerRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return workerRequest("https://example.test/webhook", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function textUpdate(updateId: number, chatId: number, userId: number, chatType = "private", text = "bantuan") {
  return { update_id: updateId, message: { from: { id: userId }, chat: { id: chatId, type: chatType }, text } };
}

function imageUpdate(updateId: number, chatId: number, userId: number, chatType = "private") {
  return { update_id: updateId, message: { from: { id: userId }, chat: { id: chatId, type: chatType }, photo: [] } };
}

function deps(): WorkerDeps {
  return {
    handleUserMessage: vi.fn(async () => "Balasan uji"),
    sendTelegramText: vi.fn(async () => undefined),
    downloadTelegramPhoto: vi.fn(async () => 'mock-base64'),
    getUpcomingTasks: vi.fn(async () => []),
    getActiveRoutines: vi.fn(async () => []),
    listMemoryContext: vi.fn(async () => []),
    generateProactiveAlarm: vi.fn(async () => 'alarm'),
    generateRoutineAlarm: vi.fn(async () => 'routine')
  };
}

describe("/webhook", () => {
  it("GET /health returns 200 ok", async () => {
    const worker = createWorker(deps());
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/health"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("missing Telegram webhook secret rejects with 401", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret({}, null), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(d.handleUserMessage).not.toHaveBeenCalled();
    expect(d.sendTelegramText).not.toHaveBeenCalled();
  });

  it("wrong Telegram webhook secret rejects with 401", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret({}, "wrong_secret"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(401);
    expect(d.handleUserMessage).not.toHaveBeenCalled();
    expect(d.sendTelegramText).not.toHaveBeenCalled();
  });

  it("GET /webhook rejects with 405 (no Meta verification challenge)", async () => {
    const worker = createWorker(deps());
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/webhook"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(405);
  });

  it("invalid JSON with valid secret rejects with 400", async () => {
    const worker = createWorker(deps());
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "test_webhook_secret_123" },
      body: "{ invalid_json }",
    }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(400);
  });

  it("update without normal message returns 200 without dedupe reservation", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret({ update_id: 1001, edited_message: {} }), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await testEnv.DEDUP_KV.get("tg:1001")).toBeNull();
  });

  it("unauthorized Telegram user returns 200 without dedupe reservation", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret(textUpdate(1002, 111111111, 999999999)), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(d.handleUserMessage).not.toHaveBeenCalled();
    expect(d.sendTelegramText).not.toHaveBeenCalled();
    expect(await testEnv.DEDUP_KV.get("tg:1002")).toBeNull();
  });

  it("non-private chat returns 200 without dedupe reservation", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret(textUpdate(1003, -123456, 111111111, "supergroup")), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(d.handleUserMessage).not.toHaveBeenCalled();
    expect(d.sendTelegramText).not.toHaveBeenCalled();
    expect(await testEnv.DEDUP_KV.get("tg:1003")).toBeNull();
  });

  it("authorized private text returns 200, creates dedupe key, calls router and send", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret(textUpdate(1004, 111111111, 111111111)), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await testEnv.DEDUP_KV.get("tg:1004")).toBe("1");
    expect(d.handleUserMessage).toHaveBeenCalledTimes(1);
    expect(d.sendTelegramText).toHaveBeenCalledTimes(1);
  });

  it("duplicate update_id processes only once", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx1 = createExecutionContext();
    const response1 = await worker.fetch!(postWithSecret(textUpdate(1005, 111111111, 111111111)), testEnv, ctx1);
    await waitOnExecutionContext(ctx1);
    const ctx2 = createExecutionContext();
    const response2 = await worker.fetch!(postWithSecret(textUpdate(1005, 111111111, 111111111)), testEnv, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(response1.status).toBe(200);
    expect(response2.status).toBe(200);
    expect(await testEnv.DEDUP_KV.get("tg:1005")).toBe("1");
    expect(d.handleUserMessage).toHaveBeenCalledTimes(1);
    expect(d.sendTelegramText).toHaveBeenCalledTimes(1);
  });

  it("authorized private unsupported media returns 200, creates dedupe key, skips router, sends specific notice", async () => {
    const d = deps();
    const worker = createWorker(d);
    const ctx = createExecutionContext();
    const response = await worker.fetch!(postWithSecret(imageUpdate(1006, 111111111, 111111111)), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await testEnv.DEDUP_KV.get("tg:1006")).toBe("1");
    expect(d.handleUserMessage).not.toHaveBeenCalled();
    expect(d.sendTelegramText).toHaveBeenCalledWith(expect.any(Object), 111111111, "V1 saat ini hanya mendukung pesan teks dan gambar.");
  });

  it("unknown route returns 404", async () => {
    const worker = createWorker(deps());
    const ctx = createExecutionContext();
    const response = await worker.fetch!(workerRequest("https://example.test/unknown"), testEnv, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(404);
  });
});
