import type { AppConfig, Env } from "./types";

function required(name: keyof Env, value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment binding: ${name}`);
  }
  return value;
}

/** Strip @s.whatsapp.net / @lid / device suffix → comparable local id */
export function normalizeWhatsappIdentity(raw: string): string {
  const local = String(raw || "")
    .trim()
    .toLowerCase()
    .split(":")[0] || "";
  return local
    .replace(/@s\.whatsapp\.net$/i, "")
    .replace(/@lid$/i, "");
}

export function parseAllowedWhatsappIdentities(raw: string): string[] {
  return String(raw)
    .split(/[,;\s]+/)
    .map((p) => normalizeWhatsappIdentity(p))
    .filter(Boolean);
}

export function isAllowedWhatsappSender(from: string, allowedRaw: string): boolean {
  const fromId = normalizeWhatsappIdentity(from);
  if (!fromId) return false;
  return parseAllowedWhatsappIdentities(allowedRaw).includes(fromId);
}

export function getConfig(env: Env): AppConfig {
  const telegramWebhookSecret = required("TELEGRAM_WEBHOOK_SECRET", env.TELEGRAM_WEBHOOK_SECRET);
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(telegramWebhookSecret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET has invalid format");
  }

  const allowedTelegramUserId = required("ALLOWED_TELEGRAM_USER_ID", env.ALLOWED_TELEGRAM_USER_ID);
  if (!/^\d+$/.test(allowedTelegramUserId)) {
    throw new Error("ALLOWED_TELEGRAM_USER_ID must contain digits only");
  }

  const allowedWhatsappRaw = required("ALLOWED_WHATSAPP_NUMBER", env.ALLOWED_WHATSAPP_NUMBER);
  const allowedWhatsappIdentities = parseAllowedWhatsappIdentities(allowedWhatsappRaw);
  if (allowedWhatsappIdentities.length === 0) {
    throw new Error("ALLOWED_WHATSAPP_NUMBER is empty/invalid");
  }
  // Prefer shorter phone-like id as primary chat key; else first entry
  const allowedWhatsappNumber =
    allowedWhatsappIdentities.find((id) => id.length <= 15) ?? allowedWhatsappIdentities[0]!;

  return {

    geminiApiKey: required("GEMINI_API_KEY", env.GEMINI_API_KEY),
    geminiModel: required("GEMINI_MODEL", env.GEMINI_MODEL),
    notionApiKey: required("NOTION_API_KEY", env.NOTION_API_KEY),
    notionVersion: required("NOTION_VERSION", env.NOTION_VERSION),
    notionInboxDataSourceId: required("NOTION_INBOX_DATA_SOURCE_ID", env.NOTION_INBOX_DATA_SOURCE_ID),
    notionTasksDataSourceId: required("NOTION_TASKS_DATA_SOURCE_ID", env.NOTION_TASKS_DATA_SOURCE_ID),
    notionMemoryDataSourceId: required("NOTION_MEMORY_DATA_SOURCE_ID", env.NOTION_MEMORY_DATA_SOURCE_ID),
    notionRoutineDbId: typeof env.NOTION_ROUTINE_DB_ID === "string" && env.NOTION_ROUTINE_DB_ID.trim() !== "" 
      ? env.NOTION_ROUTINE_DB_ID.trim() 
      : "3cf7d9b437a8808fa3cac01a6bd90919",
    notionProjectsDataSourceId:
      typeof env.NOTION_PROJECTS_DATA_SOURCE_ID === "string" && env.NOTION_PROJECTS_DATA_SOURCE_ID.trim() !== ""
        ? env.NOTION_PROJECTS_DATA_SOURCE_ID.trim()
        : null,
    telegramBotToken: required("TELEGRAM_BOT_TOKEN", env.TELEGRAM_BOT_TOKEN),
    telegramWebhookSecret,
    allowedTelegramUserId,
    whatsappApiSecret: required("WHATSAPP_API_SECRET", env.WHATSAPP_API_SECRET),
    allowedWhatsappNumber,
    allowedWhatsappIdentities,
  };
}
