import { generateChatReply, generateTaskBriefing, GeminiApiError } from "./gemini";
import type { ChatReply } from "./gemini";
import { NotionRejectionError, NotionUnknownError, createNote, createTask, listActiveTasks, listProjects, getAllTasks, getAllNotes, listMemoryContext, recallMemory, upsertMemory, getAllMemory, updateTask, archiveTask, archiveProject, createProject, updateProject, listGoals, createGoal, updateGoal, archiveGoal, listLearning, createLearning, updateLearning, archiveLearning, addRoutine } from "./notion";
import { detectBriefingRequest, selectBriefingTasks, emptyBriefingReply } from "./task-intelligence";
import {
  getInteractionId,
  saveInteractionId,
  getChatLog,
  saveChatLog,
  clearMemory,
  getPendingDelete,
  savePendingDelete,
  clearPendingDelete,
  getPendingMemory,
  savePendingMemory,
  clearPendingMemory,
  getConversationContext,
  saveConversationContext,
  clearConversationContext,
  CHAT_LOG_MAX_CHARS,
} from "./state";
import {
  buildDeleteTitleSummary,
  filterCreateTaskCalls,
  formatMemoryPropose,
  isPendingDeleteFresh,
  isPendingMemoryFresh,
  isPositiveDeleteConfirm,
  isNegativeDeleteConfirm,
  shouldConfirmMemoryWrite,
  stripInventedDueDate,
} from "./action-safety";
import type { PendingDelete, PendingMemory } from "./action-safety";
import { applyTopicSwitch, detectExplicitTopicSwitch, type ConversationContext } from "./conversation-context";
import { parseIndonesianDeadline, parseIndonesianNaturalDate } from "./date";
import { extractProjectMention, findExactProject, matchProject } from "./project-match";
import { formatProjectList, formatProjectStatus } from "./project-intelligence";
import { findExactGoal, matchGoal } from "./goal-match";
import type { AppConfig, Env, GoalRecord, ProjectRecord } from "./types";

export function sanitizeMarkdown(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "*$1*");
}

export interface RouterDeps {
  createNote: typeof createNote; createTask: typeof createTask; listActiveTasks: typeof listActiveTasks; listProjects: typeof listProjects; getAllTasks: typeof getAllTasks; getAllNotes: typeof getAllNotes;
  upsertMemory: typeof upsertMemory; recallMemory: typeof recallMemory; listMemoryContext: typeof listMemoryContext; getAllMemory: typeof getAllMemory; updateTask: typeof updateTask; archiveTask: typeof archiveTask; archiveProject: typeof archiveProject; createProject: typeof createProject; updateProject: typeof updateProject; listGoals: typeof listGoals; createGoal: typeof createGoal; updateGoal: typeof updateGoal; archiveGoal: typeof archiveGoal; listLearning: typeof listLearning; createLearning: typeof createLearning; updateLearning: typeof updateLearning; archiveLearning: typeof archiveLearning; addRoutine: typeof addRoutine;
  generateChatReply: typeof generateChatReply;
  parseIndonesianDeadline: typeof parseIndonesianDeadline;
  parseIndonesianNaturalDate: typeof parseIndonesianNaturalDate;
  getInteractionId: typeof getInteractionId; saveInteractionId: typeof saveInteractionId;
  getChatLog: typeof getChatLog; saveChatLog: typeof saveChatLog; clearMemory: typeof clearMemory;
  getPendingDelete: typeof getPendingDelete; savePendingDelete: typeof savePendingDelete; clearPendingDelete: typeof clearPendingDelete;
  getPendingMemory: typeof getPendingMemory; savePendingMemory: typeof savePendingMemory; clearPendingMemory: typeof clearPendingMemory;
  getConversationContext: typeof getConversationContext;
  saveConversationContext: typeof saveConversationContext;
  clearConversationContext: typeof clearConversationContext;
  generateTaskBriefing: typeof generateTaskBriefing;
}
const defaultDeps: RouterDeps = {
  createNote, createTask, listActiveTasks, listProjects, getAllTasks, getAllNotes, upsertMemory, recallMemory, listMemoryContext, getAllMemory, updateTask, archiveTask, archiveProject, createProject, updateProject, listGoals, createGoal, updateGoal, archiveGoal, listLearning, createLearning, updateLearning, archiveLearning, addRoutine,
  generateChatReply, parseIndonesianDeadline, parseIndonesianNaturalDate, getInteractionId, saveInteractionId, getChatLog, saveChatLog, clearMemory,
  getPendingDelete, savePendingDelete, clearPendingDelete, getPendingMemory, savePendingMemory, clearPendingMemory,
  getConversationContext, saveConversationContext, clearConversationContext,
  generateTaskBriefing,
};
const HELP = ["Perintah V1 (AI-Driven):", "• /start atau /help", "• Kirim apa saja, AI akan mengurus sisanya (catatan, tugas, memori)."].join("\n");

const DELETE_TOOL_NAMES = new Set([
  "delete_notion_tasks",
  "delete_notion_notes",
  "delete_notion_memory",
  "delete_notion_project",
  "delete_notion_goal",
]);

function deleteKindLabel(kind: PendingDelete["kind"]): string {
  if (kind === "notes") return "catatan";
  if (kind === "memory") return "memori";
  if (kind === "project") return "project";
  if (kind === "goal") return "goal";
  if (kind === "learning") return "skill";
  return "tugas";
}

/** Bridge may append `\n\n[Bridge: media…]` for sticker context — strip for phrase routing. */
export function normalizeUserTextForRouting(text: string): string {
  return text.replace(/\n\n\[Bridge:[\s\S]*$/i, "").trim();
}

export async function handleUserMessage(env: Env, userId: number | string, config: AppConfig, payload: { text: string; imageBase64?: string; audioBase64?: string; chatContext?: "dm" | "group" }, deps: RouterDeps = defaultDeps): Promise<string> {
  const normalizedText = normalizeUserTextForRouting(payload.text);
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
          if (pending.kind === "project" && !config.notionProjectsDataSourceId) {
            await deps.clearPendingDelete(env, userId);
            return "Projects belum dikonfigurasi.";
          }
          if (pending.kind === "goal" && !config.notionGoalsDataSourceId) {
            await deps.clearPendingDelete(env, userId);
            return "Goals belum dikonfigurasi.";
          }
          if (pending.kind === "learning" && !config.notionLearningDataSourceId) {
            await deps.clearPendingDelete(env, userId);
            return "Learning belum dikonfigurasi.";
          }
          let successCount = 0;
          let failCount = 0;
          for (const id of pending.ids) {
            try {
              if (pending.kind === "goal") await deps.archiveGoal(config, id);
              else if (pending.kind === "project") await deps.archiveProject(config, id);
              else if (pending.kind === "learning") await deps.archiveLearning(config, id);
              else await deps.archiveTask(config, id);
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

      // Pending-memory confirm/cancel (delete wins if both pending)
      const pendingMemory = await deps.getPendingMemory(env, userId);
      if (pendingMemory) {
        if (!isPendingMemoryFresh(pendingMemory)) {
          await deps.clearPendingMemory(env, userId);
          // fall through to Gemini
        } else if (isNegativeDeleteConfirm(normalizedText)) {
          await deps.clearPendingMemory(env, userId);
          return "Ok, batal. Tidak aku ingat.";
        } else if (isPositiveDeleteConfirm(normalizedText)) {
          await deps.upsertMemory(config, {
            key: pendingMemory.key,
            value: pendingMemory.value,
            category: pendingMemory.category,
          });
          await deps.clearPendingMemory(env, userId);
          return `Ok, sudah aku ingat *${pendingMemory.key}*.`;
        }
      }
    }

    if (!isGroup && detectBriefingRequest(normalizedText)) {
      const tasks = await deps.listActiveTasks(config);
      const memories = await deps.listMemoryContext(config);
      const selected = selectBriefingTasks(tasks, Date.now());
      if (selected.length === 0) return emptyBriefingReply();
      return deps.generateTaskBriefing(config, selected, { tasks, memories }, { source: "on_demand" });
    }

    let conversationContext: ConversationContext | null = null;
    let topicSwitchedThisTurn = false;
    if (!isGroup) {
      conversationContext = await deps.getConversationContext(env, userId);
      const detectedSwitch = detectExplicitTopicSwitch(normalizedText);
      if (detectedSwitch) {
        conversationContext = applyTopicSwitch(conversationContext, detectedSwitch.topic);
        await deps.saveConversationContext(env, userId, conversationContext);
        topicSwitchedThisTurn = true;
      }
    }

    const projectsEnabled = Boolean(config.notionProjectsDataSourceId);
    let projects: ProjectRecord[] = [];
    let projectsLoaded = false;
    const goalsEnabled = Boolean(config.notionGoalsDataSourceId);
    let goals: GoalRecord[] = [];
    let goalsLoaded = false;

    const [tasks, memories, previousInteractionId, chatLog, loadedProjects, loadedGoals] = isGroup
      ? [[], [], null as string | null, await deps.getChatLog(env, userId), [] as ProjectRecord[], [] as GoalRecord[]]
      : await Promise.all([
          deps.listActiveTasks(config),
          deps.listMemoryContext(config),
          deps.getInteractionId(env, userId),
          deps.getChatLog(env, userId),
          projectsEnabled
            ? deps.listProjects(config).catch((err) => {
                console.error("listProjects failed (continuing without projects)", err);
                return [] as ProjectRecord[];
              })
            : Promise.resolve([] as ProjectRecord[]),
          goalsEnabled
            ? deps.listGoals(config).catch((err) => {
                console.error("listGoals failed (continuing without goals)", err);
                return [] as GoalRecord[];
              })
            : Promise.resolve([] as GoalRecord[]),
        ]);
    if (projectsEnabled) {
      projects = loadedProjects;
      projectsLoaded = true;
    }
    if (goalsEnabled) {
      goals = loadedGoals;
      goalsLoaded = true;
    }

    const ensureProjects = async (): Promise<ProjectRecord[]> => {
      if (!projectsEnabled) return [];
      if (!projectsLoaded) {
        projects = await deps.listProjects(config);
        projectsLoaded = true;
      }
      return projects;
    };

    const ensureGoals = async (): Promise<GoalRecord[]> => {
      if (!goalsEnabled) return [];
      if (!goalsLoaded) {
        goals = await deps.listGoals(config);
        goalsLoaded = true;
      }
      return goals;
    };

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
            {
              tasks,
              memories,
              ...(projectsEnabled && !isGroup ? { projects } : {}),
              projectsEnabled: projectsEnabled && !isGroup,
              ...(goalsEnabled && !isGroup ? { goals } : {}),
              goalsEnabled: goalsEnabled && !isGroup,
              chatContext: isGroup ? "group" : "dm",
              conversation: isGroup ? null : conversationContext,
            },
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
        let pendingMemorySavedThisTurn = false;
        let topicUpdatedThisTurn = false;
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

          if (call.name === "create_notion_memory" && pendingMemorySavedThisTurn) {
            replyMessages.push(
              "Satu memori menunggu konfirmasi dulu. Balas \"ya\" atau \"jangan\", baru simpan yang lain.",
            );
            continue;
          }

          try {
            switch (call.name) {
              case "create_notion_task": {
                const { call: sanitizedCall, stripped: inventedDueStripped } = stripInventedDueDate(call, payload.text);
                const args = sanitizedCall.args;
                const titleLower = (args.title || "").toLowerCase().trim();
                if (titleLower && createdTaskTitles.has(titleLower)) {
                  replyMessages.push(`[System]: Tugas dengan judul '${args.title}' sudah ditambahkan di giliran sebelumnya. Skipping.`);
                  continue;
                }
                if (titleLower) createdTaskTitles.add(titleLower);
                
                let finalDueDate = args.due_date;
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
                const notes = typeof args.content === "string" ? args.content.trim() : "";
                let projectId: string | undefined;
                const fromTool = typeof args.project === "string" ? args.project.trim() : "";
                const fromText = extractProjectMention(payload.text);
                const projectArg = fromTool || fromText || "";
                if (projectsEnabled && projectArg) {
                  const knownProjects = await ensureProjects();
                  const matched = matchProject(projectArg, knownProjects);
                  if (matched.kind === "one") {
                    projectId = matched.project.id;
                  } else if (matched.kind === "none") {
                    const names = knownProjects.slice(0, 5).map((p) => p.name).join(", ");
                    replyMessages.push(
                      `Project tidak cocok. Project yang ada: ${names}. Sebut project yang mana, atau bilang tanpa project.\nMau kubuatkan project itu dulu? Bilang "buat project …".`,
                    );
                    continue;
                  } else {
                    const names = matched.candidates.map((p) => p.name).join(", ");
                    replyMessages.push(
                      `Beberapa project cocok (${names}). Sebut project yang mana, atau bilang tanpa project.`,
                    );
                    continue;
                  }
                }
                const taskPayload = { 
                  task: String(args.title || ""), 
                  priority: args.priority || "Medium", 
                  ...(finalDueDate ? { due_date: finalDueDate } : {}),
                  ...(args.due_time ? { due_time: args.due_time } : {}),
                  ...(notes ? { notes } : {}),
                  ...(projectId ? { projectId } : {}),
                };
                await deps.createTask(config, taskPayload);
                let createMsg = `Tugas '${args.title}' sudah ditambahkan dengan prioritas ${args.priority || "Medium"}.`;
                if (!finalDueDate || inventedDueStripped) {
                  createMsg += " Tenggatnya kapan, Aldo?";
                }
                replyMessages.push(createMsg);
                break;
              }
              case "read_notion_tasks": {
                const activeTasks = await deps.listActiveTasks(config, call.args.status);
                if (activeTasks.length === 0) {
                  replyMessages.push(call.args.status ? `Tidak ada tugas dengan status ${call.args.status} di Notion.` : "Tidak ada tugas aktif di Notion.");
                  break;
                }
                replyMessages.push(activeTasks.slice(0, 20).map((task, index) => `${index + 1}. [${task.priority}] ${task.task}${task.projectName ? ` ⟨${task.projectName}⟩` : ""}${task.due ? ` — ${task.due}` : ""}`).join("\n"));
                break;
              }
              case "create_notion_note": {
                await deps.createNote(config, { text: call.args.title, noteType: "Note" });
                replyMessages.push(`Catatan '${call.args.title}' sudah disimpan.`);
                break;
              }
              case "create_notion_memory": {
                const rawCategory = call.args.category;
                const category = rawCategory === "Profile" ? "Identity" : rawCategory;
                if (shouldConfirmMemoryWrite({ userText: payload.text, category })) {
                  const pending: PendingMemory = {
                    key: call.args.key,
                    value: call.args.value,
                    category,
                    createdAt: Date.now(),
                  };
                  await deps.savePendingMemory(env, userId, pending);
                  pendingMemorySavedThisTurn = true;
                  replyMessages.push(formatMemoryPropose(pending));
                  break;
                }
                await deps.upsertMemory(config, { key: call.args.key, value: call.args.value, category });
                replyMessages.push(`Memori '${call.args.key}' sudah disimpan.`);
                break;
              }
              case "create_routine": {
                await deps.addRoutine(config, call.args.name, call.args.time);
                replyMessages.push(`Rutinitas berhasil ditambahkan.`);
                break;
              }
              case "list_notion_projects": {
                if (!projectsEnabled) {
                  replyMessages.push("Projects belum dikonfigurasi.");
                  break;
                }
                const knownProjects = await ensureProjects();
                replyMessages.push(formatProjectList(knownProjects));
                break;
              }
              case "get_project_status": {
                if (!projectsEnabled) {
                  replyMessages.push("Projects belum dikonfigurasi.");
                  break;
                }
                const query = String(call.args.project || "");
                const knownProjects = await ensureProjects();
                const matched = matchProject(query, knownProjects);
                if (matched.kind === "none") {
                  const names = knownProjects.slice(0, 5).map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Project tidak cocok. Project yang ada: ${names}. Sebut project yang mana.`,
                  );
                  break;
                }
                if (matched.kind === "ambiguous") {
                  const names = matched.candidates.map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Beberapa project cocok (${names}). Sebut project yang mana.`,
                  );
                  break;
                }
                const activeTasks = await deps.listActiveTasks(config);
                const openTasks = activeTasks.filter((t) => t.projectId === matched.project.id);
                replyMessages.push(formatProjectStatus(matched.project, openTasks));
                break;
              }
              case "create_notion_project": {
                if (!projectsEnabled) {
                  replyMessages.push("Projects belum dikonfigurasi.");
                  break;
                }
                const name = typeof call.args.name === "string" ? call.args.name.trim() : "";
                if (!name) {
                  replyMessages.push("Nama project belum diisi.");
                  break;
                }
                const goalArg = typeof call.args.goal === "string" ? call.args.goal.trim() : "";
                let goalId: string | undefined;
                if (goalArg) {
                  if (!goalsEnabled) {
                    replyMessages.push("Goals belum dikonfigurasi.");
                    break;
                  }
                  const knownGoals = await ensureGoals();
                  const matchedGoal = matchGoal(goalArg, knownGoals);
                  if (matchedGoal.kind === "none") {
                    const names = knownGoals.slice(0, 5).map((g) => g.name).join(", ");
                    replyMessages.push(
                      `Goal tidak cocok. Goal yang ada: ${names}. Sebut goal yang mana.`,
                    );
                    break;
                  }
                  if (matchedGoal.kind === "ambiguous") {
                    const names = matchedGoal.candidates.map((g) => g.name).join(", ");
                    replyMessages.push(
                      `Beberapa goal cocok (${names}). Sebut goal yang mana.`,
                    );
                    break;
                  }
                  goalId = matchedGoal.goal.id;
                }
                // Dedicated re-fetch for dup-check — do not trust soft-failed empty cache
                let knownProjects: ProjectRecord[];
                try {
                  knownProjects = await deps.listProjects(config);
                  projects = knownProjects;
                  projectsLoaded = true;
                } catch (err) {
                  console.error("listProjects failed during create_notion_project dup-check", err);
                  replyMessages.push("Gagal cek project yang ada. Coba lagi sebentar.");
                  break;
                }
                if (findExactProject(name, knownProjects)) {
                  replyMessages.push(
                    `Project '${name}' sudah ada. Pakai itu atau pilih nama lain.`,
                  );
                  break;
                }
                const area = typeof call.args.area === "string" ? call.args.area.trim() : "";
                let deadline = typeof call.args.deadline === "string" ? call.args.deadline.trim() : "";
                if (deadline) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(deadline, new Date());
                  if (naturalParsed) deadline = naturalParsed;
                }
                const createdId = await deps.createProject(config, {
                  name,
                  ...(area ? { area } : {}),
                  ...(deadline ? { deadline } : {}),
                  ...(goalId ? { goalId } : {}),
                });
                projects = [
                  ...knownProjects,
                  { id: createdId, name, ...(area ? { area } : {}), ...(goalId ? { goalId } : {}) },
                ];
                projectsLoaded = true;
                replyMessages.push(`Project '${name}' sudah dibuat.`);
                break;
              }
              case "update_notion_project": {
                if (!projectsEnabled) {
                  replyMessages.push("Projects belum dikonfigurasi.");
                  break;
                }
                const query = typeof call.args.project === "string" ? call.args.project.trim() : "";
                const knownProjects = await ensureProjects();
                const matched = matchProject(query, knownProjects);
                if (matched.kind === "none") {
                  const names = knownProjects.slice(0, 5).map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Project tidak cocok. Project yang ada: ${names}. Sebut project yang mana.`,
                  );
                  break;
                }
                if (matched.kind === "ambiguous") {
                  const names = matched.candidates.map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Beberapa project cocok (${names}). Sebut project yang mana.`,
                  );
                  break;
                }
                const goalArg = typeof call.args.goal === "string" ? call.args.goal.trim() : "";
                let goalId: string | undefined;
                if (goalArg) {
                  if (!goalsEnabled) {
                    replyMessages.push("Goals belum dikonfigurasi.");
                    break;
                  }
                  const knownGoals = await ensureGoals();
                  const matchedGoal = matchGoal(goalArg, knownGoals);
                  if (matchedGoal.kind === "none") {
                    const names = knownGoals.slice(0, 5).map((g) => g.name).join(", ");
                    replyMessages.push(
                      `Goal tidak cocok. Goal yang ada: ${names}. Sebut goal yang mana.`,
                    );
                    break;
                  }
                  if (matchedGoal.kind === "ambiguous") {
                    const names = matchedGoal.candidates.map((g) => g.name).join(", ");
                    replyMessages.push(
                      `Beberapa goal cocok (${names}). Sebut goal yang mana.`,
                    );
                    break;
                  }
                  goalId = matchedGoal.goal.id;
                }
                const newName = typeof call.args.new_name === "string" ? call.args.new_name.trim() : "";
                const area = typeof call.args.area === "string" ? call.args.area.trim() : "";
                let deadline = typeof call.args.deadline === "string" ? call.args.deadline.trim() : "";
                if (deadline) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(deadline, new Date());
                  if (naturalParsed) deadline = naturalParsed;
                }
                const update: { name?: string; area?: string; deadline?: string; goalId?: string } = {};
                if (newName) update.name = newName;
                if (area) update.area = area;
                if (deadline) update.deadline = deadline;
                if (goalId) update.goalId = goalId;
                await deps.updateProject(config, matched.project.id, update);
                replyMessages.push(`Project '${matched.project.name}' berhasil diperbarui.`);
                break;
              }
              case "delete_notion_project": {
                if (!projectsEnabled) {
                  replyMessages.push("Projects belum dikonfigurasi.");
                  break;
                }
                const query = typeof call.args.project === "string" ? call.args.project.trim() : "";
                const knownProjects = await ensureProjects();
                const matched = matchProject(query, knownProjects);
                if (matched.kind === "none") {
                  const names = knownProjects.slice(0, 5).map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Project tidak cocok. Project yang ada: ${names}. Sebut project yang mana.`,
                  );
                  break;
                }
                if (matched.kind === "ambiguous") {
                  const names = matched.candidates.map((p) => p.name).join(", ");
                  replyMessages.push(
                    `Beberapa project cocok (${names}). Sebut project yang mana.`,
                  );
                  break;
                }
                await deps.savePendingDelete(env, userId, {
                  kind: "project",
                  ids: [matched.project.id],
                  summary: matched.project.name,
                  createdAt: Date.now(),
                });
                pendingDeleteSavedThisTurn = true;
                replyMessages.push(
                  `Aldo, yakin hapus project ${matched.project.name}? Task di dalamnya tidak ikut terhapus. Balas "ya" atau "jangan".`,
                );
                break;
              }
              case "create_notion_goal": {
                if (!goalsEnabled) {
                  replyMessages.push("Goals belum dikonfigurasi.");
                  break;
                }
                const name = typeof call.args.name === "string" ? call.args.name.trim() : "";
                if (!name) {
                  replyMessages.push("Nama goal belum diisi.");
                  break;
                }
                let knownGoals: GoalRecord[];
                try {
                  knownGoals = await deps.listGoals(config);
                  goals = knownGoals;
                  goalsLoaded = true;
                } catch (err) {
                  console.error("listGoals failed during create_notion_goal dup-check", err);
                  replyMessages.push("Gagal cek goal yang ada. Coba lagi sebentar.");
                  break;
                }
                if (findExactGoal(name, knownGoals)) {
                  replyMessages.push(
                    `Goal '${name}' sudah ada. Pakai itu atau pilih nama lain.`,
                  );
                  break;
                }
                const area = typeof call.args.area === "string" ? call.args.area.trim() : "";
                const metric = typeof call.args.metric === "string" ? call.args.metric.trim() : "";
                const status = typeof call.args.status === "string" ? call.args.status.trim() : "";
                let target_date = typeof call.args.target_date === "string" ? call.args.target_date.trim() : "";
                if (target_date) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(target_date, new Date());
                  if (naturalParsed) target_date = naturalParsed;
                }
                const notes = typeof call.args.notes === "string" ? call.args.notes.trim() : "";
                let progress: string | number | undefined;
                if (typeof call.args.progress === "number" && Number.isFinite(call.args.progress)) {
                  progress = call.args.progress;
                } else if (typeof call.args.progress === "string" && call.args.progress.trim()) {
                  const raw = call.args.progress.trim();
                  const n = Number(raw);
                  progress = Number.isFinite(n) ? n : raw;
                }
                const createdId = await deps.createGoal(config, {
                  name,
                  ...(area ? { area } : {}),
                  ...(metric ? { metric } : {}),
                  ...(progress !== undefined ? { progress } : {}),
                  ...(status ? { status } : {}),
                  ...(target_date ? { target_date } : {}),
                  ...(notes ? { notes } : {}),
                });
                goals = [
                  ...knownGoals,
                  { id: createdId, name, ...(area ? { area } : {}), ...(status ? { status } : {}) },
                ];
                goalsLoaded = true;
                replyMessages.push(`Goal '${name}' sudah dibuat.`);
                break;
              }
              case "update_notion_goal": {
                if (!goalsEnabled) {
                  replyMessages.push("Goals belum dikonfigurasi.");
                  break;
                }
                const query = typeof call.args.goal === "string" ? call.args.goal.trim() : "";
                const knownGoals = await ensureGoals();
                const matched = matchGoal(query, knownGoals);
                if (matched.kind === "none") {
                  const names = knownGoals.slice(0, 5).map((g) => g.name).join(", ");
                  replyMessages.push(
                    `Goal tidak cocok. Goal yang ada: ${names}. Sebut goal yang mana.`,
                  );
                  break;
                }
                if (matched.kind === "ambiguous") {
                  const names = matched.candidates.map((g) => g.name).join(", ");
                  replyMessages.push(
                    `Beberapa goal cocok (${names}). Sebut goal yang mana.`,
                  );
                  break;
                }
                const newName = typeof call.args.new_name === "string" ? call.args.new_name.trim() : "";
                const area = typeof call.args.area === "string" ? call.args.area.trim() : "";
                const metric = typeof call.args.metric === "string" ? call.args.metric.trim() : "";
                const status = typeof call.args.status === "string" ? call.args.status.trim() : "";
                let target_date = typeof call.args.target_date === "string" ? call.args.target_date.trim() : "";
                if (target_date) {
                  const naturalParsed = deps.parseIndonesianNaturalDate(target_date, new Date());
                  if (naturalParsed) target_date = naturalParsed;
                }
                const notes = typeof call.args.notes === "string" ? call.args.notes.trim() : "";
                let progress: string | number | undefined;
                if (typeof call.args.progress === "number" && Number.isFinite(call.args.progress)) {
                  progress = call.args.progress;
                } else if (typeof call.args.progress === "string" && call.args.progress.trim()) {
                  const raw = call.args.progress.trim();
                  const n = Number(raw);
                  progress = Number.isFinite(n) ? n : raw;
                }
                const update: {
                  name?: string;
                  area?: string;
                  metric?: string;
                  progress?: string | number;
                  status?: string;
                  target_date?: string;
                  notes?: string;
                } = {};
                if (newName) update.name = newName;
                if (area) update.area = area;
                if (metric) update.metric = metric;
                if (progress !== undefined) update.progress = progress;
                if (status) update.status = status;
                if (target_date) update.target_date = target_date;
                if (notes) update.notes = notes;
                await deps.updateGoal(config, matched.goal.id, update);
                replyMessages.push(`Goal '${matched.goal.name}' berhasil diperbarui.`);
                break;
              }
              case "delete_notion_goal": {
                if (!goalsEnabled) {
                  replyMessages.push("Goals belum dikonfigurasi.");
                  break;
                }
                const query = typeof call.args.goal === "string" ? call.args.goal.trim() : "";
                const knownGoals = await ensureGoals();
                const matched = matchGoal(query, knownGoals);
                if (matched.kind === "none") {
                  const names = knownGoals.slice(0, 5).map((g) => g.name).join(", ");
                  replyMessages.push(
                    `Goal tidak cocok. Goal yang ada: ${names}. Sebut goal yang mana.`,
                  );
                  break;
                }
                if (matched.kind === "ambiguous") {
                  const names = matched.candidates.map((g) => g.name).join(", ");
                  replyMessages.push(
                    `Beberapa goal cocok (${names}). Sebut goal yang mana.`,
                  );
                  break;
                }
                await deps.savePendingDelete(env, userId, {
                  kind: "goal",
                  ids: [matched.goal.id],
                  summary: matched.goal.name,
                  createdAt: Date.now(),
                });
                pendingDeleteSavedThisTurn = true;
                replyMessages.push(
                  `Aldo, yakin hapus goal ${matched.goal.name}? Project di bawahnya tidak ikut terhapus. Balas "ya" atau "jangan".`,
                );
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
              case "set_conversation_topic": {
                const topic = typeof call.args.topic === "string" ? call.args.topic.trim() : "";
                if (!topic) {
                  replyMessages.push("[System]: topic missing; provide a non-empty topic.");
                  break;
                }
                const sameAsCurrent =
                  conversationContext?.currentTopic.trim().toLowerCase() === topic.toLowerCase();
                if (!topicSwitchedThisTurn && !sameAsCurrent) {
                  conversationContext = applyTopicSwitch(conversationContext, topic);
                  await deps.saveConversationContext(env, userId, conversationContext);
                }
                topicUpdatedThisTurn = true;
                replyMessages.push(`[System]: topic updated to ${topic}`);
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
        } else if (topicUpdatedThisTurn && replyMessages.every((m) => m.startsWith("[System]:"))) {
          currentInput = `CONVERSATION HISTORY:\n${currentLog}\n\n[ACTION REQUIRED] Conversation topic was updated. Continue responding to the latest User message in the new topic. Do not call set_conversation_topic again unless the subject changes again.`;
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
