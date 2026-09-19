import type { AppConfig, IncomingTelegramMessage, TelegramChatType } from "./types";

export function isTelegramWebhookSecretValid(
  header: string | null,
  expected: string
): boolean {
  if (!header || !expected) return false;
  return header === expected;
}

export function extractTelegramMessage(payload: unknown): IncomingTelegramMessage | null {
  if (!payload || typeof payload !== "object") return null;

  const p = payload as any;
  if (!p.update_id || !Number.isSafeInteger(p.update_id)) return null;

  const msg = p.message;
  if (!msg) return null;

  if (!msg.from || !msg.from.id || !Number.isSafeInteger(msg.from.id)) return null;
  if (!msg.chat || !msg.chat.id || !Number.isSafeInteger(msg.chat.id)) return null;

  const chatType = msg.chat.type;
  if (
    typeof chatType !== "string" ||
    !["private", "group", "supergroup", "channel"].includes(chatType)
  ) {
    return null;
  }

  let kind: "text" | "photo" | "unsupported" = "unsupported";
  let text: string | undefined = undefined;
  let photoFileId: string | undefined = undefined;

  if (Array.isArray(msg.photo) && msg.photo.length > 0) {
    kind = "photo";
    text = msg.caption || "";
    // get highest resolution (last element)
    photoFileId = msg.photo[msg.photo.length - 1].file_id;
  } else if (typeof msg.text === "string") {
    kind = "text";
    text = msg.text;
  }

  return {
    updateId: p.update_id,
    chatId: msg.chat.id,
    userId: msg.from.id,
    chatType: chatType as TelegramChatType,
    kind,
    ...(text !== undefined ? { text } : {}),
    ...(photoFileId !== undefined ? { photoFileId } : {}),
  };
}

export async function downloadTelegramPhoto(
  config: AppConfig,
  fileId: string,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const getFileUrl = `https://api.telegram.org/bot${config.telegramBotToken}/getFile?file_id=${fileId}`;
  const getFileRes = await fetchImpl(getFileUrl);
  if (!getFileRes.ok) {
    throw new Error(`Failed to get file info: ${getFileRes.status}`);
  }
  const fileData = (await getFileRes.json()) as any;
  if (!fileData.ok || !fileData.result?.file_path) {
    throw new Error(`Failed to get file_path from Telegram`);
  }

  const filePath = fileData.result.file_path;
  const downloadUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${filePath}`;
  
  const downloadRes = await fetchImpl(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(`Failed to download photo: ${downloadRes.status}`);
  }
  
  const arrayBuffer = await downloadRes.arrayBuffer();
  // Buffer is not available in all Cloudflare Workers without import, we can use btoa or convert from Uint8Array
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i] as number);
  }
  return btoa(binary);
}

export async function sendTelegramText(
  config: AppConfig,
  chatId: number,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const body = JSON.stringify({ chat_id: chatId, text });

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    throw new Error(`Telegram send failed: network error`);
  }

  if (res.status === 429 || res.status >= 500) {
    try {
      res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
    } catch (err) {
      throw new Error(`Telegram send failed: network error on retry`);
    }
  }

  if (!res.ok) {
    throw new Error(`Telegram send failed with HTTP ${res.status}`);
  }

  let data: any;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error(`Telegram send failed: API returned ok=false or invalid JSON`);
  }

  if (!data || data.ok !== true) {
    throw new Error(`Telegram send failed: API returned ok=false or invalid JSON`);
  }
}
