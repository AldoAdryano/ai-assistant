import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["node_modules", "dist", ".idea", ".git", ".cache", "backup_v1_stable", "whatsapp-bridge/**"],
    env: {
      VITEST: "true",
      NODE_ENV: "test",
    },
    pool: "threads",
    poolOptions: {
      threads: { singleThread: true },
    },
    maxWorkers: 1,
    minWorkers: 1,
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      isolate: false,
      miniflare: {
        kvNamespaces: ["DEDUP_KV"],
        bindings: {
          GEMINI_API_KEY: "test-gemini-key",
          NOTION_API_KEY: "test-notion-key", NOTION_INBOX_DATA_SOURCE_ID: "test-inbox-ds", NOTION_TASKS_DATA_SOURCE_ID: "test-tasks-ds",
          NOTION_MEMORY_DATA_SOURCE_ID: "test-memory-ds",
          TELEGRAM_BOT_TOKEN: "123456:test-bot-token", TELEGRAM_WEBHOOK_SECRET: "test_webhook_secret_123", ALLOWED_TELEGRAM_USER_ID: "111111111",
          WHATSAPP_API_SECRET: "test_wa_secret", ALLOWED_WHATSAPP_NUMBER: "6281234567890"
        }
      }
    }),
  ],
});
