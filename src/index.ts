import { getConfig, isAllowedWhatsappSender } from "./config";
import { handleUserMessage } from "./router";
import type { AppConfig, Env, IncomingTelegramMessage } from "./types";
import { extractTelegramMessage, isTelegramWebhookSecretValid, sendTelegramText, downloadTelegramPhoto } from "./telegram";
import { getUpcomingTasks, getActiveRoutines, listMemoryContext } from "./notion";
import { generateChatReply, generateProactiveAlarm, generateRoutineAlarm, generateTaskBriefing } from "./gemini";
import { isDailyReminderSlot, selectBriefingTasks, selectUrgentTasks, mergeAlarmTaskLists } from "./task-intelligence";

async function queueAlarm(env: Env, msg: string) {
  try {
    const raw = await env.DEDUP_KV.get("pending_alarms");
    const alarms = raw ? JSON.parse(raw) : [];
    alarms.push(msg);
    await env.DEDUP_KV.put("pending_alarms", JSON.stringify(alarms));
  } catch (err) {
    console.error("Failed to queue alarm", err);
  }
}

const DEDUP_TTL_SECONDS = 86400;

export interface WorkerDeps {
  handleUserMessage: typeof handleUserMessage;
  sendTelegramText: typeof sendTelegramText;
  downloadTelegramPhoto: typeof downloadTelegramPhoto;
  getUpcomingTasks: typeof getUpcomingTasks;
  getActiveRoutines: typeof getActiveRoutines;
  listMemoryContext: typeof listMemoryContext;
  generateProactiveAlarm: typeof generateProactiveAlarm;
  generateTaskBriefing: typeof generateTaskBriefing;
  generateRoutineAlarm: typeof generateRoutineAlarm;
}

const defaultDeps: WorkerDeps = {
  handleUserMessage,
  sendTelegramText,
  downloadTelegramPhoto,
  getUpcomingTasks,
  getActiveRoutines,
  listMemoryContext,
  generateProactiveAlarm,
  generateTaskBriefing,
  generateRoutineAlarm,
};

async function processMessage(env: Env, config: AppConfig, message: IncomingTelegramMessage, deps: WorkerDeps): Promise<void> {
  if (message.kind === "unsupported") {
    await deps.sendTelegramText(config, message.chatId, "V1 saat ini hanya mendukung pesan teks dan gambar.");
    return;
  }
  
  let imageBase64: string | undefined = undefined;
  if (message.kind === "photo" && message.photoFileId) {
    try {
      imageBase64 = await deps.downloadTelegramPhoto(config, message.photoFileId);
    } catch (err) {
      console.error("Failed to download photo:", err);
      await deps.sendTelegramText(config, message.chatId, "Maaf, gagal mengunduh gambar. Memproses pesan teks saja jika ada.");
    }
  }

  const payload: { text: string; imageBase64?: string } = { text: message.text || (imageBase64 ? "Tolong analisis gambar ini." : "") };
  if (imageBase64) payload.imageBase64 = imageBase64;
  const reply = await deps.handleUserMessage(env, message.userId, config, payload);
  await deps.sendTelegramText(config, message.chatId, reply);
}

export async function runScheduled(event: ScheduledController, env: Env, ctx: ExecutionContext, deps: WorkerDeps = defaultDeps): Promise<void> {
  const config = getConfig(env);
  try {
    const tasks = await deps.getUpcomingTasks(config);
    const memories = await deps.listMemoryContext(config);
    const nowMs = Date.now();
    // Konversi waktu sekarang ke UTC+7 (WIB)
    const nowWib = new Date(nowMs + 7 * 60 * 60 * 1000);
    const currentHour = nowWib.getUTCHours();
    const currentMinute = nowWib.getUTCMinutes();
    const dailySlot = isDailyReminderSlot(currentHour, currentMinute);

    const urgent = selectUrgentTasks(tasks, nowMs);
    const briefing = dailySlot ? selectBriefingTasks(tasks, nowMs) : [];

    if (urgent.length > 0 && briefing.length > 0) {
      const remainder = mergeAlarmTaskLists(urgent, briefing).slice(urgent.length);
      const urgentMsg = await deps.generateProactiveAlarm(config, urgent, { tasks, memories });
      const briefMsg = remainder.length
        ? await deps.generateTaskBriefing(config, remainder, { tasks, memories }, { source: "cron" })
        : "";
      await queueAlarm(env, briefMsg ? `${urgentMsg}\n\n${briefMsg}` : urgentMsg);
    } else if (urgent.length > 0) {
      await queueAlarm(env, await deps.generateProactiveAlarm(config, urgent, { tasks, memories }));
    } else if (briefing.length > 0) {
      await queueAlarm(env, await deps.generateTaskBriefing(config, briefing, { tasks, memories }, { source: "cron" }));
    }

    const routines = await deps.getActiveRoutines(config);
    const routinesToRemind: any[] = [];
    const todayWibDateStr = `${nowWib.getUTCFullYear()}-${String(nowWib.getUTCMonth()+1).padStart(2, '0')}-${String(nowWib.getUTCDate()).padStart(2, '0')}`;
    
    for (const r of routines) {
      // time misal "06:30"
      const timeParts = r.time.split(":");
      if (timeParts.length === 2 && timeParts[0] !== undefined && timeParts[1] !== undefined) {
        const hh = String(parseInt(timeParts[0])).padStart(2, '0');
        const mm = String(parseInt(timeParts[1])).padStart(2, '0');
        
        // Buat epoch ms dari waktu tersebut HARI INI di zona WIB (+07:00)
        // Format ISO Date = 2026-09-02T06:30:00+07:00
        const routineDate = new Date(`${todayWibDateStr}T${hh}:${mm}:00+07:00`);
        if (!isNaN(routineDate.getTime())) {
          const diffMs = routineDate.getTime() - nowMs;
          const diffMinutes = diffMs / (1000 * 60);
          
          if (diffMinutes > 50 && diffMinutes <= 60) {
            routinesToRemind.push(r);
          }
        }
      }
    }

    if (routinesToRemind.length > 0) {
      const routineMsg = await deps.generateRoutineAlarm(config, routinesToRemind, { tasks, memories });
      await queueAlarm(env, routineMsg);
    }

  } catch (error) {
    console.error("Scheduled execution failed", error);
  }
}

export function createWorker(deps: WorkerDeps = defaultDeps): ExportedHandler<Env> {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }
      const config = getConfig(env);

      if (request.method === "GET" && url.pathname === "/whatsapp/poll") {
        if (request.headers.get("X-WhatsApp-Api-Secret") !== config.whatsappApiSecret) {
          return new Response("Unauthorized", { status: 401 });
        }
        const raw = await env.DEDUP_KV.get("pending_alarms");
        let alarms: string[] = [];
        if (raw) {
          try { alarms = JSON.parse(raw); } catch (e) {}
          await env.DEDUP_KV.delete("pending_alarms");
        }
        return Response.json({ alarms });
      }

      if (request.method === "POST" && url.pathname === "/whatsapp") {
        if (request.headers.get("X-WhatsApp-Api-Secret") !== config.whatsappApiSecret) {
          return new Response("Unauthorized", { status: 401 });
        }
        
        let payload: any;
        try {
          payload = JSON.parse(await request.text());
        } catch {
          return new Response("Bad request", { status: 400 });
        }

        if (!isAllowedWhatsappSender(String(payload.from || ""), env.ALLOWED_WHATSAPP_NUMBER)) {
          return new Response("Forbidden", { status: 403 });
        }

        const reply = await deps.handleUserMessage(env, 
          payload.chatContext === "group" && payload.chatId
            ? `wa-group:${String(payload.chatId)}`
            : config.allowedWhatsappNumber,
          config, { 
          text: payload.text || (payload.imageBase64 ? "Tolong analisis gambar ini." : (payload.audioBase64 ? "Tolong dengarkan pesan suara ini." : "")), 
          imageBase64: payload.imageBase64,
          audioBase64: payload.audioBase64,
          chatContext: payload.chatContext === "group" ? "group" : "dm",
        });
        return Response.json({ replies: [reply] });
      }

      if (url.pathname !== "/webhook") {
        return new Response("Not found", { status: 404 });
      }
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      const secretToken = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      
      if (!isTelegramWebhookSecretValid(secretToken, config.telegramWebhookSecret)) {
        return new Response("Unauthorized", { status: 401 });
      }

      let payload: unknown;
      try {
        payload = JSON.parse(await request.text());
      } catch {
        return new Response("Bad request", { status: 400 });
      }

      const message = extractTelegramMessage(payload);
      if (!message) {
        return new Response("OK", { status: 200 });
      }

      if (message.chatType !== "private") {
        return new Response("OK", { status: 200 });
      }

      if (String(message.userId) !== config.allowedTelegramUserId) {
        return new Response("OK", { status: 200 });
      }

      const key = `tg:${message.updateId}`;
      if (await env.DEDUP_KV.get(key)) {
        return new Response("OK", { status: 200 });
      }
      
      await env.DEDUP_KV.put(key, "1", { expirationTtl: DEDUP_TTL_SECONDS });

      ctx.waitUntil(
        processMessage(env, config, message, deps).catch((error) => {
          console.error("background message processing failed", {
            updateId: message.updateId,
            error: error instanceof Error ? error.message : "unknown error",
          });
        })
      );

      return new Response("OK", { status: 200 });
    },
    async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
      return runScheduled(event, env, ctx, deps);
    }
  } satisfies ExportedHandler<Env>;
}

export default createWorker();
