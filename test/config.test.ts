import { describe, expect, it } from "vitest";
import { getConfig, isAllowedWhatsappSender, parseAllowedWhatsappIdentities } from "../src/config";
import type { Env } from "../src/types";

const testEnv = {
    DEDUP_KV: {} as KVNamespace,


    TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
    TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret_123",
    ALLOWED_TELEGRAM_USER_ID: "111111111",
    
    WHATSAPP_API_SECRET: "test_wa_secret",
    ALLOWED_WHATSAPP_NUMBER: "6281234567890",

    GEMINI_API_KEY: "test-gemini-key",

    NOTION_API_KEY: "test-notion-key",
    NOTION_INBOX_DATA_SOURCE_ID: "test-inbox-ds",
    NOTION_TASKS_DATA_SOURCE_ID: "test-tasks-ds",
    NOTION_MEMORY_DATA_SOURCE_ID: "test-memory-ds",

    GEMINI_MODEL: "gemini-3.5-flash-lite",
    NOTION_VERSION: "2026-03-11",
} as Env;

describe("getConfig Telegram migration bridge", () => {
    it("reads Telegram bindings", () => {
        const config = getConfig(testEnv);

        expect(config.telegramBotToken).toBe("123456:test-bot-token");
        expect(config.telegramWebhookSecret).toBe(
            "test_webhook_secret_123",
        );
        expect(config.allowedTelegramUserId).toBe("111111111");
    });

    it("rejects a nonnumeric allowed Telegram user ID", () => {
        expect(() =>
            getConfig({
                ...testEnv,
                ALLOWED_TELEGRAM_USER_ID: "not-a-number",
            }),
        ).toThrow(
            "ALLOWED_TELEGRAM_USER_ID must contain digits only",
        );
    });

    it("rejects an invalid Telegram webhook secret", () => {
        expect(() =>
            getConfig({
                ...testEnv,
                TELEGRAM_WEBHOOK_SECRET: "invalid secret with spaces",
            }),
        ).toThrow(
            "TELEGRAM_WEBHOOK_SECRET has invalid format",
        );
    });

    it("accepts PN + LID allowlist", () => {
        const config = getConfig({
            ...testEnv,
            ALLOWED_WHATSAPP_NUMBER: "6288983776936,238035878838303@lid",
        });
        expect(config.allowedWhatsappNumber).toBe("6288983776936");
        expect(config.allowedWhatsappIdentities).toEqual([
            "6288983776936",
            "238035878838303",
        ]);
        expect(isAllowedWhatsappSender("6288983776936", "6288983776936,238035878838303@lid")).toBe(true);
        expect(isAllowedWhatsappSender("238035878838303@lid", "6288983776936,238035878838303@lid")).toBe(true);
        expect(isAllowedWhatsappSender("628111111111", "6288983776936,238035878838303@lid")).toBe(false);
        expect(parseAllowedWhatsappIdentities("6288983776936")).toEqual(["6288983776936"]);
    });
});
