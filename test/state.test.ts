import { describe, expect, it, vi } from "vitest";
import type { Env } from "../src/types";
import { CHAT_LOG_TTL_SECONDS, saveChatLog } from "../src/state";

describe("chat log persistence", () => {
  it("stores chat logs for at least 7 days so Youyou remembers yesterday", async () => {
    expect(CHAT_LOG_TTL_SECONDS).toBeGreaterThanOrEqual(7 * 24 * 3600);

    const put = vi.fn(async (_key: string, _value: string, _opts?: { expirationTtl?: number }) => undefined);
    const env = { DEDUP_KV: { put } } as unknown as Env;
    await saveChatLog(env, "62812", "User: aku sakit pilek");
    expect(put).toHaveBeenCalledWith(
      "chat_log:62812",
      "User: aku sakit pilek",
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
    const options = put.mock.calls[0]?.[2] as { expirationTtl?: number } | undefined;
    expect(options?.expirationTtl).toBeGreaterThanOrEqual(7 * 24 * 3600);
  });
});
