import { describe, expect, it, vi } from "vitest";
import {
  isTelegramWebhookSecretValid,
  extractTelegramMessage,
  sendTelegramText,
} from "../src/telegram";
import type { AppConfig } from "../src/types";

describe("Telegram Transport Boundary", () => {
  describe("isTelegramWebhookSecretValid", () => {
    it("returns true for correct secret", () => {
      expect(isTelegramWebhookSecretValid("my_secret", "my_secret")).toBe(true);
    });

    it("returns false for wrong secret", () => {
      expect(isTelegramWebhookSecretValid("wrong_secret", "my_secret")).toBe(false);
    });

    it("returns false for null/missing secret", () => {
      expect(isTelegramWebhookSecretValid(null, "my_secret")).toBe(false);
    });
  });

  describe("extractTelegramMessage", () => {
    it("extracts private text Telegram message", () => {
      const payload = {
        update_id: 9001,
        message: {
          from: { id: 111111111 },
          chat: { id: 111111111, type: "private" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload)).toEqual({
        updateId: 9001,
        chatId: 111111111,
        userId: 111111111,
        chatType: "private",
        kind: "text",
        text: "bantuan",
      });
    });

    it("parses group message and includes chatType: group", () => {
      const payload = {
        update_id: 9002,
        message: {
          from: { id: 111111111 },
          chat: { id: -123456, type: "group" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload)).toEqual({
        updateId: 9002,
        chatId: -123456,
        userId: 111111111,
        chatType: "group",
        kind: "text",
        text: "bantuan",
      });
    });

    it("returns null for unknown/malformed chat.type", () => {
      const payload = {
        update_id: 9003,
        message: {
          from: { id: 111111111 },
          chat: { id: 111111111, type: "unknown_type" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload)).toBeNull();

      const payload2 = {
        update_id: 9003,
        message: {
          from: { id: 111111111 },
          chat: { id: 111111111 }, // missing type
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload2)).toBeNull();
    });

    it("marks valid non-text message as unsupported", () => {
      const payload = {
        update_id: 9004,
        message: {
          from: { id: 111111111 },
          chat: { id: 111111111, type: "private" },
          photo: [],
        },
      };
      expect(extractTelegramMessage(payload)).toEqual({
        updateId: 9004,
        chatId: 111111111,
        userId: 111111111,
        chatType: "private",
        kind: "unsupported",
      });
    });

    it("returns null for non-message update", () => {
      const payload = {
        update_id: 9005,
        edited_message: {
          from: { id: 111111111 },
          chat: { id: 111111111, type: "private" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload)).toBeNull();
    });

    it("returns null for malformed update_id/from.id/chat.id", () => {
      const payload1 = {
        update_id: "not_a_number",
        message: {
          from: { id: 111111111 },
          chat: { id: 111111111, type: "private" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload1)).toBeNull();

      const payload2 = {
        update_id: 9006,
        message: {
          from: { id: "not_a_number" },
          chat: { id: 111111111, type: "private" },
          text: "bantuan",
        },
      };
      expect(extractTelegramMessage(payload2)).toBeNull();
    });
  });

  describe("sendTelegramText", () => {
    const config = {
      telegramBotToken: "test_bot_token",
    } as AppConfig;

    it("uses correct Telegram endpoint, method, headers, and body", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: {} }),
      });

      await sendTelegramText(config, 123456, "hello", fetchImpl);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as any[];
      expect(url).toBe("https://api.telegram.org/bottest_bot_token/sendMessage");
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual({
        chat_id: 123456,
        text: "hello",
      });
    });

    it("rejects HTTP 200 with ok:false without retry", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false }),
      });

      await expect(sendTelegramText(config, 123456, "hello", fetchImpl))
        .rejects.toThrow("Telegram send failed: API returned ok=false or invalid JSON");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("rejects invalid JSON response without retry", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => { throw new Error("Invalid JSON"); },
      });

      await expect(sendTelegramText(config, 123456, "hello", fetchImpl))
        .rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("rejects permanent HTTP 400 without retry", async () => {
      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
      });

      await expect(sendTelegramText(config, 123456, "hello", fetchImpl))
        .rejects.toThrow("Telegram send failed with HTTP 400");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("retries exactly once on HTTP 429", async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

      await sendTelegramText(config, 123456, "hello", fetchImpl);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("retries exactly once on HTTP 503", async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce({ ok: false, status: 503 })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

      await sendTelegramText(config, 123456, "hello", fetchImpl);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("throws if retry also fails", async () => {
      const fetchImpl = vi.fn()
        .mockResolvedValue({ ok: false, status: 500 });

      await expect(sendTelegramText(config, 123456, "hello", fetchImpl))
        .rejects.toThrow("Telegram send failed with HTTP 500");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });
});
