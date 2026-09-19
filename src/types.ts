export type IntentType =
  | "CHAT"
  | "ADD_NOTE"
  | "ADD_TASK"
  | "LIST_TASKS"
  | "REMEMBER"
  | "RECALL"
  | "HELP"
  | "UNKNOWN";

export type Priority = "Low" | "Medium" | "High";
export type NoteType = "Idea" | "Note";
export type MemoryCategory =
  | "Identity"
  | "Preference"
  | "Goal"
  | "Project"
  | "Pattern"
  | "Other"
  | "Profile"; // legacy read

export interface Env {
  DEDUP_KV: KVNamespace;

  GEMINI_API_KEY: string;
  NOTION_API_KEY: string;
  NOTION_INBOX_DATA_SOURCE_ID: string;
  NOTION_TASKS_DATA_SOURCE_ID: string;
  NOTION_MEMORY_DATA_SOURCE_ID: string;
  NOTION_ROUTINE_DB_ID?: string;
  NOTION_PROJECTS_DATA_SOURCE_ID?: string;

  GEMINI_MODEL: string;
  NOTION_VERSION: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_TELEGRAM_USER_ID: string;

  WHATSAPP_API_SECRET: string;
  ALLOWED_WHATSAPP_NUMBER: string;
}

export interface AppConfig {

  geminiApiKey: string;
  geminiModel: string;
  notionApiKey: string;
  notionVersion: string;
  notionInboxDataSourceId: string;
  notionTasksDataSourceId: string;
  notionMemoryDataSourceId: string;
  notionRoutineDbId: string;
  notionProjectsDataSourceId: string | null;
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedTelegramUserId: string;

  whatsappApiSecret: string;
  /** Primary id (first entry) — used as chat user key */
  allowedWhatsappNumber: string;
  /** All accepted identities (PN and/or LID), normalized local-part */
  allowedWhatsappIdentities: string[];
}

export interface ParsedIntent {
  type: IntentType;
  raw: string;
  text?: string;
  noteType?: NoteType;
  priority?: Priority;
  due?: string;
  key?: string;
  value?: string;
  category?: MemoryCategory;
  query?: string;
}


export type TelegramChatType =
  | "private"
  | "group"
  | "supergroup"
  | "channel";

export interface IncomingTelegramMessage {
  updateId: number;
  chatId: number;
  userId: number;
  chatType: TelegramChatType;
  kind: "text" | "photo" | "unsupported";
  text?: string;
  photoFileId?: string;
  imageBase64?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  area?: string | null;
}

export interface TaskRecord {
  id: string;
  task: string;
  status: "To Do" | "Doing" | "Done";
  priority: Priority;
  due?: string;
  projectId?: string | null;
  projectName?: string | null;
}

export interface RoutineRecord {
  id: string;
  name: string;
  time: string; // misal "06:30"
}

export interface MemoryRecord {
  id: string;
  key: string;
  value: string;
  category: MemoryCategory;
}

export interface DeadlineParseResult {
  kind: "none" | "resolved" | "needs_clarification";
  due?: string;
  reason?: "missing_month" | "missing_weekday" | string;
  partial?: { date?: number; month?: number; year?: number };
  matchedText?: string;
}

export interface NormalizedTaskResult {
  title: string;
  due?: string;
  content?: string;
  priority: Priority;
  deadlineParseResult: DeadlineParseResult;
  source: string;
}

