import { generateChatReply, GeminiApiError } from "./gemini";
import type { ChatReply } from "./gemini";
import { NotionRejectionError, NotionUnknownError, createNote, createTask, listActiveTasks, getAllTasks, getAllNotes, listMemoryContext, recallMemory, upsertMemory, getAllMemory, updateTask, archiveTask, addRoutine } from "./notion";
import { getInteractionId, saveInteractionId, getChatLog, saveChatLog, clearMemory, getPendingDelete, savePendingDelete, clearPendingDelete, CHAT_LOG_MAX_CHARS } from "./state";
import {
  buildDeleteTitleSummary,
  filterCreateTaskCalls,
  isPendingDeleteFresh,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
} from "./action-safety";
import type { PendingDelete } from "./action-safety";
import { parseIndonesianDeadline, parseIndonesianNaturalDate } from "./date";
import type { AppConfig, Env } from "./types";

export function sanitizeMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
}

export interface RouterDeps {
  createNote: typeof createNote; createTask: typeof createTask; listActiveTasks: typeof listActiveTasks; getAllTasks: typeof getAllTasks; getAllNotes: typeof getAllNotes;
  upsertMemory: typeof upsertMemory; recallMemory: typeof recallMemory; listMemoryContext: typeof listMemoryContext; getAllMemory: typeof getAllMemory; updateTask: typeof updateTask; archiveTask: typeof archiveTask; addRoutine: typeof addRoutine;
  generateChatReply: typeof generateChatReply;
  parseIndonesianDeadline: typeof parseIndonesianDeadline;
  parseIndonesianNaturalDate: typeof parseIndonesianNaturalDate;
  getInteractionId: typeof getInteractionId; saveInteractionId: typeof saveInteractionId;
  getChatLog: typeof getChatLog; saveChatLog: typeof saveChatLog; clearMemory: typeof clearMemory;
  getPendingDelete: typeof getPendingDelete; savePendingDelete: typeof savePendingDelete; clearPendingDelete: typeof clearPendingDelete;
}
const defaultDeps: RouterDeps = { createNote, createTask, listActiveTasks, getAllTasks, getAllNotes, upsertMemory, recallMemory, listMemoryContext, getAllMemory, updateTask, archiveTask, addRoutine, generateChatReply, parseIndonesianDeadline, parseIndonesianNaturalDate, getInteractionId, saveInteractionId, getChatLog, saveChatLog, clearMemory, getPendingDelete, savePendingDelete, clearPendingDelete };
const HELP = ["Perintah V1 (AI-Driven):", "• /start atau /help", "• Kirim apa saja, AI akan mengurus sisanya (catatan, tugas, memori)."].join("\n");

const DELETE_TOOL_NAMES = new Set([
  "delete_notion_tasks",
  "delete_notion_notes",
  "delete_notion_memory",
]);

function deleteKindLabel(kind: PendingDelete["kind"]): string {
  if (kind === "notes") return "catatan";
  if (kind === "memory") return "memori";
  return "tugas";
}

export async function handleUserMessage(env: Env, userId: number | string, config: AppConfig, payload: { text: string; imageBase64?: string; audioBase64?: string; chatContext?: "dm" | "group" }, deps: RouterDeps = defaultDeps): Promise<string> {
  const normalizedText = payload.text.trim();
  const isGroup = payload.chatContext === "group";
  if (normalizedText === "/start" || normalizedText === "/help") return HELP;
  if (normalizedText.toLowerCase() === "/reset") {
    if (isGroup) {
      return "Di grup tidak ada memori pribadi yang bisa di-reset. Chat pribadi saja kalau mau /reset.";
    }
    await deps.clearMemory(env, userId);
    return "Memori percakapan berhasil dihapus! Asisten siap menerima instruksi baru dari awal.";
  }

  try {
    // Pending-delete confirm/cancel (inside try so KV errors get soft fallback)
    if (!isGroup) {
      const pending = await deps.getPendingDelete(env, userId);
      if (pending) {
        if (!isPendingDeleteFresh(pending)) {
          await deps.clearPendingDelete(env, userId);
          // fall through to Gemini
        } else if (isNegativeDeleteConfirm(normalizedText)) {
          await deps.clearPendingDelete(env, userId);
          return "Ok, batal hapus. Tidak ada yang dihapus.";
        } else if (isPositiveDeleteConfirm(normalizedText)) {
          let successCount = 0;
          let failCount = 0;
          for (const id of pending.ids) {
            try {
              await deps.archiveTask(config, id);
              successCount++;
            } catch {
              failCount++;
            }
          }
          const label = deleteKindLabel(pending.kind);
          if (successCount === 0) {
            // Keep pending so user can retry
            return `Gagal menghapus ${failCount} ${label}. Balas "ya" lagi untuk coba ulang, atau "jangan" untuk batal.`;
          }
          await deps.clearPendingDelete(env, userId);
          if (failCount > 0) {
            return `Berhasil menghapus ${successCount} ${label}, gagal ${failCount}.`;
          }
          return `Berhasil menghapus ${successCount} ${label}.`;
        }
      }
    }

    const [tasks, memories, previousInteractionId, chatLog] = isGroup
      ? [[], [], null as string | null, await deps.getChatLog(env, userId)]
      : await Promise.all([
          deps.listActiveTasks(config),
          deps.listMemoryContext(config),
          deps.getInteractionId(env, userId),
          deps.getChatLog(env, userId),
        ]);

    let currentLog = chatLog ? chatLog + "\nUser: " + payload.text : "User: " + payload.text;
    if (payload.imageBase64) currentLog += " [Attached Image]";
    if (payload.audioBase64) currentLog += " [Attached Audio]";
    
    // Instead of passing a simple string to Gemini, we pass the payload which contains the image
    let currentInput = `CONVERSATION HISTORY:\n${currentLog}\n\n[ACTION REQUIRED] Respond to the latest User message.`;
    let currentPreviousId = previousInteractionId;
    
    let continueLoop = true;
    let turnCount = 0;
    let finalResponse = HELP;
    const executedTools = new Set<string>();
    const createdTaskTitles = new Set<string>();

    while (continueLoop && turnCount < 5) {
      turnCount++;
      
      let reply: ChatReply | null = null;
      let generateErr: any = null;
      let maxAttempts = 5;
      let textOnlyFallback = false;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          // Pass the imageBase64 on the first turn only
          const imageBase64 = (!textOnlyFallback && turnCount === 1) ? payload.imageBase64 : undefined;
          const audioBase64 = (!textOnlyFallback && turnCount === 1) ? payload.audioBase64 : undefined;
          const msgPayload: { text: string; imageBase64?: string; audioBase64?: string } = { text: currentInput };
          if (imageBase64) msgPayload.imageBase64 = imageBase64;
          if (audioBase64) msgPayload.audioBase64 = audioBase64;
          reply = await deps.generateChatReply(
            config,
            msgPayload,
            { tasks, memories, chatContext: isGroup ? "group" : "dm" },
            isGroup ? null : currentPreviousId,
          );
          generateErr = null;
          break;
        } catch (err) {
          generateErr = err;
          const errType = err instanceof GeminiApiError ? err.type : "UNKNOWN_ERROR";
          const isTransient =
            errType === "LOCATION_UNSUPPORTED" ||
            errType === "RATE_LIMIT" ||
            errType === "TIMEOUT" ||
            errType === "MEDIA_ERROR";

          if (!isTransient) break;

          // After a couple of media failures, retry text-only (often fixes LOCATION_UNSUPPORTED)
          if (
            !textOnlyFallback &&
            attempt >= 2 &&
            (payload.imageBase64 || payload.audioBase64) &&
            (errType === "LOCATION_UNSUPPORTED" || errType === "MEDIA_ERROR")
          ) {
            console.error(`[Attempt ${attempt}] ${errType} with media → fallback text-only`);
            textOnlyFallback = true;
          }

          if (attempt < maxAttempts) {
            // Skip sleep in unit tests (Vitest / NODE_ENV=test)
            const inTest =
              process.env.VITEST === "true" ||
              process.env.NODE_ENV === "test" ||
              typeof (globalThis as { __vitest_worker__?: unknown }).__vitest_worker__ !== "undefined";
            const delay = inTest
              ? 0
              : Math.min(800 * Math.pow(1.6, attempt - 1), 5000) + Math.floor(Math.random() * 400);
            console.error(`[Attempt ${attempt}] ${errType}. Retrying in ${Math.round(delay)}ms...`);
            if (delay > 0) await new Promise(r => setTimeout(r, delay));
          } else {
            console.error(`[Attempt ${attempt}] ${errType}. Giving up.`);
          }
        }
      }
      
      if (!reply) {
        if (executedTools.size > 0 && currentLog.includes("\nSystem: ")) {
          const systemLogs = currentLog.split("\nSystem: ").slice(1).join("\n");
          const cleanLogs = systemLogs.split("\n").filter(line => !line.includes("[System]: Tool")).join("\n").trim();
          finalResponse = `${cleanLogs}\n\n(Model AI sedang sibuk/timeout, tetapi data di atas berhasil dieksekusi.)`;
          continueLoop = false;
          break;
        } else {
          throw generateErr;
        }
      }
      
      if (reply.interactionId && !isGroup) {
        currentPreviousId = reply.interactionId;
        await deps.saveInteractionId(env, userId, reply.interactionId);
      }
      
      const botReplyString = reply.type === "text" ? reply.text : `[Action: ${reply.calls.map(c => c.name).join(", ")}]`;
      currentLog += "\nBot: " + botReplyString;

      if (reply.type === "function_calls") {
        if (isGroup) {
          finalResponse = "Hih, di grup aku tidak mengurus tugas/catatan pribadi. Chat pribadi saja, Tuan Muda!";
          continueLoop = false;
          break;
        }
        const replyMessages: string[] = [];
        const filtered = filterCreateTaskCalls(reply.calls, payload.text);
        if (filtered.blocked && filtered.clarifyMessage) {
          replyMessages.push(filtered.clarifyMessage);
        }
        const callsToProcess = filtered.allowed;
        let pendingDeleteSavedThisTurn = false;
        for (const call of callsToProcess) {
          const callSignature = call.name + JSON.stringify(call.args);
          if (executedTools.has(callSignature)) {
            replyMessages.push(`[System]: Tool ${call.name} with these arguments was already executed. Skipping. DO NOT repeat it.`);
            continue;
          }
          executedTools.add(callSignature);

          if (DELETE_TOOL_NAMES.has(call.name) && pendingDeleteSavedThisTurn) {
            replyMessages.push(
              "Satu batch konfirmasi hapus saja per giliran. Konfirmasi yang pertama dulu (balas \"ya\" atau \"jangan\"), baru hapus batch lain.",
            );
            continue;
          }

          try {
            switch (call.name) {
              case "create_notion_task": {
                const titleLower = (call.args.title || "").toLowerCase().trim();
                if (titleLower && createdTaskTitles.has(titleLower)) {
                  replyMessages.push(`[System]: Tugas dengan judul '${call.args.title}' sudah ditambahkan di giliran sebelumnya. Skipping.`);
                  continue;
                }
                if (titleLower) createdTaskTitles.add(titleLower);
                
                let finalDueDate = call.args.due_date;
                if (finalDueDate) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(finalDueDate, new Date());
                  if (naturalParsed) {
                    finalDueDate = naturalParsed;
                  } else {
                    const parseResult = deps.parseIndonesianDeadline(`deadline ${finalDueDate}`);
                    if (parseResult.kind === "needs_clarification") {
                      if (parseResult.reason === "missing_weekday") replyMessages.push("Hari apa minggu depan?");
                      else if (parseResult.reason === "missing_month") replyMessages.push("Bulan apa?");
                      else if (parseResult.reason === "missing_day") replyMessages.push("Tanggal berapa?");
                      else replyMessages.push("Mohon perjelas tanggal deadline tersebut.");
                      continue;
                    }
                    if (parseResult.kind === "resolved" && parseResult.due) {
                      finalDueDate = parseResult.due;
                    }
                  }
                }
                const taskPayload = { 
                  task: (call.args.title || "") + (call.args.content ? `\n\nKonteks: ${call.args.content}` : ""), 
                  priority: call.args.priority || "Medium", 
                  ...(finalDueDate ? { due_date: finalDueDate } : {}),
                  ...(call.args.due_time ? { due_time: call.args.due_time } : {})
                };
                await deps.createTask(config, taskPayload);
                replyMessages.push(`Tugas '${call.args.title}' sudah ditambahkan dengan prioritas ${call.args.priority || "Medium"}.`);
                break;
              }
              case "read_notion_tasks": {
                const activeTasks = await deps.listActiveTasks(config, call.args.status);
                if (activeTasks.length === 0) {
                  replyMessages.push(call.args.status ? `Tidak ada tugas dengan status ${call.args.status} di Notion.` : "Tidak ada tugas aktif di Notion.");
                  break;
                }
                replyMessages.push(activeTasks.slice(0, 20).map((task, index) => `${index + 1}. [${task.priority}] ${task.task}${task.due ? ` — ${task.due}` : ""}`).join("\n"));
                break;
              }
              case "create_notion_note": {
                await deps.createNote(config, { text: call.args.title, noteType: "Note" });
                replyMessages.push(`Catatan '${call.args.title}' sudah disimpan.`);
                break;
              }
              case "create_notion_memory": {
                await deps.upsertMemory(config, { key: call.args.key, value: call.args.value, category: call.args.category });
                replyMessages.push(`Memori '${call.args.key}' sudah disimpan.`);
                break;
              }
              case "create_routine": {
                await deps.addRoutine(config, call.args.name, call.args.time);
                replyMessages.push(`Rutinitas berhasil ditambahkan.`);
                break;
              }
              case "update_notion_task": {
                let finalDueDate = call.args.due_date;
                if (finalDueDate) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(finalDueDate, new Date());
                  if (naturalParsed) {
                    finalDueDate = naturalParsed;
                  } else {
                    const parseResult = deps.parseIndonesianDeadline(`deadline ${finalDueDate}`);
                    if (parseResult.kind === "needs_clarification") {
                      if (parseResult.reason === "missing_weekday") replyMessages.push("Hari apa minggu depan?");
                      else if (parseResult.reason === "missing_month") replyMessages.push("Bulan apa?");
                      else if (parseResult.reason === "missing_day") replyMessages.push("Tanggal berapa?");
                      else replyMessages.push("Mohon perjelas tanggal jadwal tersebut.");
                      continue;
                    }
                    if (parseResult.kind === "resolved" && parseResult.due) {
                      finalDueDate = parseResult.due;
                    }
                  }
                }
                const updatePayload = { ...call.args };
                if (finalDueDate) updatePayload.due_date = finalDueDate;
                await deps.updateTask(config, call.args.taskId, updatePayload);
                replyMessages.push(`Tugas berhasil diperbarui.`);
                break;
              }
              case "delete_notion_tasks": {
                const keywords = Array.isArray(call.args.keywords) ? call.args.keywords : [];
                if (keywords.length === 0) {
                  replyMessages.push("Tidak ada kata kunci tugas yang diberikan untuk dihapus.");
                  break;
                }
                
                const allTasks = await deps.getAllTasks(config);
                let matched: typeof allTasks = [];
                
                if (keywords.includes("ALL")) {
                  matched = allTasks;
                } else {
                  for (const task of allTasks) {
                    const cleanTaskName = task.task.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const isMatch = keywords.some((kw: string) => {
                      const cleanKeyword = kw.toLowerCase().replace(/tugas/g, '').replace(/[^a-z0-9]/g, '');
                      return cleanKeyword.length > 2 && cleanTaskName.includes(cleanKeyword);
                    });
                    if (isMatch) matched.push(task);
                  }
                }
                
                if (matched.length === 0) {
                  replyMessages.push("Tidak ada tugas yang cocok untuk dihapus.");
                  break;
                }

                const matchedIds = matched.map((t) => t.id);
                const summary = buildDeleteTitleSummary(matched.map((t) => t.task));
                await deps.savePendingDelete(env, userId, {
                  kind: "tasks",
                  ids: matchedIds,
                  summary,
                  createdAt: Date.now(),
                });
                pendingDeleteSavedThisTurn = true;
                replyMessages.push(
                  `Aldo, aku nemu ${matchedIds.length} tugas buat dihapus: ${summary}. Yakin? Balas "ya" atau "jangan".`,
                );
                break;
              }
              case "delete_notion_notes": {
                const keywords = Array.isArray(call.args.keywords) ? call.args.keywords : [];
                if (keywords.length === 0) {
                  replyMessages.push("Tidak ada kata kunci catatan yang diberikan untuk dihapus.");
                  break;
                }
                
                const allNotes = await deps.getAllNotes(config);
                let matched: typeof allNotes = [];
                
                if (keywords.includes("ALL")) {
                  matched = allNotes;
                } else {
                  for (const note of allNotes) {
                    const cleanNoteTitle = note.title.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const isMatch = keywords.some((kw: string) => {
                      const cleanKeyword = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
                      return cleanKeyword.length > 2 && cleanNoteTitle.includes(cleanKeyword);
                    });
                    if (isMatch) matched.push(note);
                  }
                }
                
                if (matched.length === 0) {
                  replyMessages.push("Tidak ada catatan yang cocok untuk dihapus.");
                  break;
                }

                const matchedIds = matched.map((n) => n.id);
                const summary = buildDeleteTitleSummary(matched.map((n) => n.title));
                await deps.savePendingDelete(env, userId, {
                  kind: "notes",
                  ids: matchedIds,
                  summary,
                  createdAt: Date.now(),
                });
                pendingDeleteSavedThisTurn = true;
                replyMessages.push(
                  `Aldo, aku nemu ${matchedIds.length} catatan buat dihapus: ${summary}. Yakin? Balas "ya" atau "jangan".`,
                );
                break;
              }
              case "read_notion_notes": {
                const allNotes = await deps.getAllNotes(config);
                if (allNotes.length === 0) {
                  replyMessages.push("Tidak ada catatan di Inbox Notion.");
                  break;
                }
                replyMessages.push(allNotes.slice(0, 20).map((note, index) => `${index + 1}. [ID: ${note.id}] ${note.title}`).join("\n"));
                break;
              }
              case "delete_notion_memory": {
                const keywords = Array.isArray(call.args.keywords) ? call.args.keywords : [];
                if (keywords.length === 0) {
                  replyMessages.push("Tidak ada kata kunci memori yang diberikan untuk dihapus.");
                  break;
                }
                
                const allMemory = await deps.getAllMemory(config);
                let matched: typeof allMemory = [];
                
                if (keywords.includes("ALL")) {
                  matched = allMemory;
                } else {
                  for (const mem of allMemory) {
                    const cleanMemKey = mem.key.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const isMatch = keywords.some((kw: string) => {
                      const cleanKeyword = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
                      return cleanKeyword.length > 2 && cleanMemKey.includes(cleanKeyword);
                    });
                    if (isMatch) matched.push(mem);
                  }
                }
                
                if (matched.length === 0) {
                  replyMessages.push("Tidak ada memori yang cocok untuk dihapus.");
                  break;
                }

                const matchedIds = matched.map((m) => m.id);
                const summary = buildDeleteTitleSummary(matched.map((m) => m.key));
                await deps.savePendingDelete(env, userId, {
                  kind: "memory",
                  ids: matchedIds,
                  summary,
                  createdAt: Date.now(),
                });
                pendingDeleteSavedThisTurn = true;
                replyMessages.push(
                  `Aldo, aku nemu ${matchedIds.length} memori buat dihapus: ${summary}. Yakin? Balas "ya" atau "jangan".`,
                );
                break;
              }
              default:
                replyMessages.push(`Fungsi ${call.name} tidak dikenali.`);
            }
          } catch (err) {
            if (err instanceof NotionRejectionError) {
               replyMessages.push(`Notion menolak eksekusi ${call.name} (kemungkinan format salah).`);
            } else {
               replyMessages.push(`Terjadi gangguan jaringan atau server saat mengeksekusi ${call.name}.`);
            }
          }
        }
        
        const toolResultString = replyMessages.join("\n");
        currentLog += "\nSystem: " + toolResultString;
        
        // Cukup hentikan loop segera jika fungsi berhasil dieksekusi (kecuali minta klarifikasi tanggal)
        const isWaitingForClarification = replyMessages.some(m => 
          m.includes("Hari apa") || m.includes("Bulan apa") || m.includes("Tanggal berapa") || m.includes("Mohon perjelas")
        );
        
        if (isWaitingForClarification) {
          currentInput = `CONVERSATION HISTORY:\n${currentLog}\n\n[ACTION REQUIRED] System Observation: Needs clarification. Output: ${toolResultString}. Ask the user for the missing details in natural Indonesian.`;
        } else {
           // Fungsi sukses dieksekusi, kita tidak perlu jawaban LLM lagi, jadikan ini jawaban akhir
           finalResponse = toolResultString;
           continueLoop = false;
        }
      } else if (reply.type === "text") {
        finalResponse = reply.text;
        continueLoop = false;
      }
    }

    await deps.saveChatLog(env, userId, currentLog.slice(-CHAT_LOG_MAX_CHARS));

    // Sanitize any remaining Telegram-style markdown for WhatsApp compatibility
    finalResponse = sanitizeMarkdown(finalResponse);

    return finalResponse;

  } catch (err) {
    console.error(err);
    // Jangan kirim pesan "koneksi AI bermasalah" — fallback singkat bergaya Youyou.
    // Kegagalan total tetap bisa terjadi (batas API/region Gemini); retry di atas sudah diperketat.
    if (err instanceof GeminiApiError) {
      if (isGroup) {
        return "Hmph… sebentar, otakku nge-lag. Ulangi sekali lagi ya.";
      }
      return "Hmph… otakku lagi nge-lag sebentar, Tuan Muda. Kirim ulang pesanmu sekali lagi.";
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[router] non-Gemini failure:", errMsg);
    if (isGroup) {
      return "Hmph… sebentar, ada gangguan kecil. Coba lagi ya.";
    }
    return "Hmph… ada gangguan kecil di sistemku. Coba kirim ulang sebentar lagi, Tuan Muda.";
  }
}
