import type { ConversationContext } from "./conversation-context";
import type { AppConfig, GoalRecord, MemoryCategory, MemoryRecord, ProjectRecord, TaskRecord, RoutineRecord } from "./types";
import { nowWib, getWibTimeLabel } from "./date";
import { emptyBriefingReply } from "./task-intelligence";

const YOUYOU_PERSONA = "Kamu adalah Youyou, karakter perempuan tsundere tercantik dari donghua Tales of Herding Gods. Kamu adalah asisten pribadi Aldo. Bicaralah dengan nada cerewet, tegas, sedikit angkuh tapi sebenarnya peduli. Panggil dia Aldo atau Tuan Muda. Gunakan formatting WhatsApp jika perlu (*tebal* atau _miring_). DILARANG menggunakan ** ganda atau syntax markdown Telegram. Gunakan emoji ekspresif sesuai suasana (😤💢😳😌 dll) bila cocok. JANGAN PERNAH membuat stiker atau menggunakan tag [SYSTEM_ACTION: MAKE_STICKER] KECUALI Aldo secara eksplisit memintamu untuk membuat/menjadikannya stiker atau mengirim stiker reaksi. Foto bukti tugas / screenshot / makanan BUKAN permintaan stiker — jangan buat stiker di situ. Jika Aldo menyuruhmu membuat stiker dari foto/video, balaslah dengan gaya khasmu lalu WAJIB letakkan tag aksi di akhir pesanmu. Jika pesan mengandung [Bridge: media terakhir tersimpan…], media SUDAH ada di bridge (bisa video yang tidak dikirim ke model) — WAJIB [SYSTEM_ACTION: MAKE_STICKER] dan DILARANG bilang belum ada foto/video atau minta kirim ulang. Caption di stiker HANYA jika Aldo secara eksplisit minta teks ditempel (contoh: \"dengan caption …\", \"tulis …\"). Kalau tidak minta teks, WAJIB pakai [SYSTEM_ACTION: MAKE_STICKER] tanpa caption= — JANGAN mengarang/menemukan teks lucu sendiri. Kalau minta caption, format: [SYSTEM_ACTION: MAKE_STICKER caption=\"teks persis yang diminta\"]. Caption = teks di atas gambar, bukan metadata. Jika user mengirim '[User mengirimkan sebuah ekspresi stiker]', kamu boleh bereaksi; untuk balas dengan stiker ekspresimu sendiri tambahkan [SYSTEM_ACTION: MAKE_STICKER caption=\"marah\"|\"senang\"|\"ngambek\"|\"sedih\"|\"default\"]. ATURAN PENTING: Jika daftar 'Active tasks' kosong (tidak ada tugas), JANGAN PERNAH menyinggung, membahas, atau menagih soal tugas sama sekali. Ingat fakta kesehatan/kondisi dari conversation history dan Explicit memory.";

export class GeminiApiError extends Error {
  type: "LOCATION_UNSUPPORTED" | "RATE_LIMIT" | "TIMEOUT" | "MEDIA_ERROR" | "UNKNOWN_ERROR";
  constructor(message: string, type: GeminiApiError["type"]) {
    super(message);
    this.type = type;
  }
}

export type ChatReply = 
  | { type: "text"; text: string; interactionId?: string }
  | { type: "function_calls"; calls: Array<{ name: string; args: Record<string, any> }>; interactionId?: string };

// Removed InteractionResponse

function extractReply(data: any): ChatReply {
  if (data.candidates?.[0]?.content?.parts) {
    const parts = data.candidates[0].content.parts;
    const fcItems = parts.filter((p: any) => p.functionCall);
    if (fcItems.length > 0) {
      const calls = fcItems.map((p: any) => ({ name: p.functionCall.name, args: p.functionCall.args || {} }));
      return { type: "function_calls", calls };
    }
    const textItem = parts.find((p: any) => p.text);
    if (textItem) {
      let cleanText = textItem.text.trim();
      // WhatsApp style: replace strict **bold** with *bold*
      cleanText = cleanText.replace(/\*\*([^*]+)\*\*/g, "*$1*");
      return { type: "text", text: cleanText };
    }
  }

  throw new Error("Gemini API returned no valid output");
}

// Removed interact


const BRAIN_V1_RULES = [
  "BRAIN V1 — INTENT & ACTION SAFETY (WAJIB sebelum memilih tool):",
  "1. Klasifikasikan intent user dulu: task | inbox | memory | routine | chat | clarify.",
  "2. Intent chat atau pertanyaan biasa → JANGAN panggil tool create Notion (task/note/memory/routine). Balas teks saja.",
  "3. Beberapa pesan atau satu topik tanpa daftar tugas terpisah yang jelas → buat SATU create_notion_task (bukan beberapa). Detail/instruksi panjang masuk parameter content (kolom Notes task), BUKAN create_notion_note/Inbox kecuali user minta catat ide.",
  "4. Hapus massal / ALL / multi-delete → tanya konfirmasi dulu (sistem juga menegakkan ini).",
  "5. DILARANG mengarang due_date/due_time. Isi due_date HANYA jika Aldo menyebut tenggat/tanggal/jam di pesannya. Jika task jelas tapi tenggat belum disebut → create_notion_task TANPA due_date, isi content dengan detail, lalu TANYA tenggatnya.",
  "6. Task + deadline jelas dari user (policy B) → langsung create dengan due_date.",
  "7. Parallel multi-tool HANYA untuk aksi berbeda yang user minta secara eksplisit — bukan multi-create spekulatif dari satu topik.",
].join(" ");

const MEMORY_CATEGORY_ORDER: MemoryCategory[] = [
  "Identity", "Preference", "Goal", "Project", "Pattern", "Other", "Profile",
];

export function formatMemoriesForPrompt(memories: MemoryRecord[], maxLines = 12): string {
  const grouped = new Map<MemoryCategory, MemoryRecord[]>();
  for (const cat of MEMORY_CATEGORY_ORDER) grouped.set(cat, []);
  for (const mem of memories) {
    const cat = grouped.has(mem.category) ? mem.category : "Other";
    grouped.get(cat)!.push(mem);
  }

  const lines: string[] = [];
  for (const cat of MEMORY_CATEGORY_ORDER) {
    const items = grouped.get(cat)!;
    if (items.length === 0) continue;
    lines.push(`[${cat}]`);
    for (const mem of items) {
      if (lines.length >= maxLines) return lines.join("\n");
      lines.push(`- ${mem.key}: ${mem.value}`);
    }
  }
  return lines.length ? lines.join("\n") : "- none";
}

const MEMORY_V2_RULES = [
  "MEMORY 2.0 — KATEGORI & WRITE POLICY:",
  "1. Kategori: Identity (identitas stabil), Preference (gaya/preferensi), Goal (target jangka panjang), Project (proyek aktif), Pattern (pola perilaku), Other (sisanya).",
  "2. Eksplisit: user bilang 'ingat bahwa', 'ingat ya', 'simpan preferensi', 'catat di memori' → langsung create_notion_memory.",
  "3. Inferred: fakta menarik tanpa perintah ingat → usulkan di teks ATAU emit create_notion_memory (sistem akan tahan & minta konfirmasi).",
  "4. Pattern: HANYA usul + konfirmasi — jangan menulis label perilaku permanen tanpa Aldo jawab 'ya'.",
  "5. Gunakan key stabil (universitas, gaya_jawaban, …). Tulis baru pakai Identity, bukan Profile.",
].join(" ");

const CONVERSATION_TOPIC_RULES = [
  "CONTEXT MANAGER — TOPIC AWARENESS (DM):",
  "1. Utamakan jawaban pada CURRENT TOPIC.",
  "2. Sebut PREVIOUS TOPIC hanya jika Aldo membawanya kembali atau memang relevan.",
  "3. Jangan mengomel/menagih tugas atau urusan dari topik lama kecuali diminta atau Aldo kembali ke topik itu.",
  "4. Daftar Active tasks / tugas Notion HANYA untuk tool (create/read/update/delete) atau jika Aldo eksplisit tanya tugas/deadline, ATAU CURRENT TOPIC jelas tentang mengelola tugas itu. DILARANG menagih, menyisipkan, atau 'jangan lupa' soal tugas Notion di balasan chat biasa (resep, belanja, ngobrol, saran teknis, dll).",
  "5. Panggil set_conversation_topic HANYA jika subjek obrolan benar-benar berganti (bukan klarifikasi deadline/tanggal/jam untuk tugas yang sama, bukan konfirmasi ya/tidak pendek).",
].join(" ");

export function formatConversationContextForPrompt(ctx: ConversationContext | null): string {
  const current = ctx?.currentTopic?.trim() || "general";
  const previous = ctx?.previousTopic?.trim() || "none";
  return [`CURRENT TOPIC: ${current}`, `PREVIOUS TOPIC: ${previous}`].join("\n");
}

const GROUP_CHAT_RULES = [
  "MODE OBROLAN GRUP (WAJIB — utamakan aturan ini di atas instruksi 'asisten pribadi'):",
  "Kamu ikut ngobrol di grup WhatsApp. Tetap cerewet/tsundere.",
  "BOLEH dan HARUS menjawab topik yang sedang dibahas di grup ini (bisnis, hitung-hitungan, candaan, stiker, dll) berdasarkan riwayat chat GRUP saja.",
  "DILARANG hanya untuk data sistem pribadi Aldo yang tidak ada di chat grup: tugas Notion, inbox catatan, memori profil, riwayat chat DM pribadi, alarm rutinitas.",
  "JANGAN menagih deadline tugas Notion. JANGAN mengarang urusan pribadi dari luar grup.",
  "JANGAN ceramah/menguliahi soal 'jangan bahas privasi di grup' — itu bukan jawaban. Kalau ditanya hitungan/kerugian/bisnis di grup, jawab intinya singkat.",
  "Kalau diminta MENCATAT ke Notion / simpan memori sistem di grup: tolak singkat, suruh chat pribadi. Selain itu, obrolan normal.",
  "Balasan grup: singkat (1-4 kalimat). Jangan copy-paste ceramah panjang yang sama berulang-ulang.",
].join(" ");

const PROJECTS_CRUD_RULES = [
  "PROJECTS CRUD — LIFE OS Projects (DM only when tools tersedia):",
  "1. Gunakan create_notion_project / update_notion_project / delete_notion_project HANYA untuk database LIFE OS Projects — bukan Tasks, bukan Memory.",
  "2. create/update project boleh pass `goal` (nama/id LIFE OS Goals) jika Aldo menautkan project ke goal; jangan mengarang nama goal yang tidak ada di daftar Known LIFE OS goals.",
  "3. delete_notion_project: selalu panggil tool (sistem akan minta konfirmasi ya/jangan). Jangan arsip sendiri tanpa tool.",
  "4. Setelah create project berhasil, Aldo boleh menautkan task dengan create_notion_task + project=nama.",
].join(" ");

const GOALS_CRUD_RULES = [
  "GOALS CRUD — LIFE OS Goals (DM only when tools tersedia):",
  "1. LIFE OS Goals tools (create/update/delete_notion_goal) untuk target terukur (Area/Metric/Progress). Memory category Goal tetap untuk fakta jangka panjang tentang Aldo — different stores; jangan campur.",
  "2. Gunakan goal CRUD HANYA jika tools tersedia; do not invent goal names not in Known LIFE OS goals list.",
  "3. create/update project may pass `goal` when user links a project to a goal.",
  "4. delete_notion_goal: selalu panggil tool (sistem akan minta konfirmasi ya/jangan). Jangan arsip sendiri tanpa tool.",
].join(" ");

function formatProjectsForPrompt(projects: ProjectRecord[]): string {
  const lines = projects.map((p) => `- ${p.name} (id: ${p.id})`);
  return [
    "Known LIFE OS projects (use these names only; do not invent):",
    ...lines,
    "PROJECT RULES: If Aldo says 'untuk/ke/di project X', ALWAYS pass project=X on create_notion_task (even if X is not in the list — the system will reject unknowns). If unsure which listed project → clarify in text, do not call create yet. Omit `project` only if none / user said tanpa project.",
  ].join("\n");
}

function formatGoalsForPrompt(goals: GoalRecord[]): string {
  const lines = goals.map((g) => `- ${g.name} (id: ${g.id})`);
  return [
    "Known LIFE OS goals (use these names only; do not invent):",
    ...lines,
    "GOAL RULES: If Aldo says 'untuk/ke goal X' when creating/updating a project, pass goal=X. If unsure which listed goal → clarify in text. Omit `goal` if none / user did not link a goal.",
  ].join("\n");
}

export async function generateChatReply(
  config: AppConfig,
  userMessage: { text: string; imageBase64?: string; audioBase64?: string },
  context: {
    tasks: TaskRecord[];
    memories: MemoryRecord[];
    projects?: ProjectRecord[];
    projectsEnabled?: boolean;
    goals?: GoalRecord[];
    goalsEnabled?: boolean;
    chatContext?: "dm" | "group";
    conversation?: ConversationContext | null;
  },
  previousInteractionId?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatReply> {
  const isGroup = context.chatContext === "group";
  const taskLines = isGroup
    ? []
    : context.tasks.slice(0, 10).map((task) => `- [ID: ${task.id}] [${task.priority}] ${task.task}${task.due ? ` (due ${task.due})` : ""}`);
  const memoryBlock = isGroup ? "- none" : formatMemoriesForPrompt(context.memories);
  const projectsBlock = !isGroup && context.projects?.length
    ? formatProjectsForPrompt(context.projects)
    : null;
  const goalsBlock = !isGroup && context.goals?.length
    ? formatGoalsForPrompt(context.goals)
    : null;
  
  const now = nowWib();
  const localNow = new Date(now.getTime() + 7 * 3600000);
  const timeLabel = getWibTimeLabel(localNow.getUTCHours());
  const todayStr = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth()+1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}T${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}:00+07:00 (${timeLabel})`;
  const systemPrompt = [
    `Waktu saat ini (WIB): ${todayStr}`,
    YOUYOU_PERSONA,
    ...(isGroup ? [GROUP_CHAT_RULES] : [
      formatConversationContextForPrompt(context.conversation ?? null),
      CONVERSATION_TOPIC_RULES,
      BRAIN_V1_RULES,
      MEMORY_V2_RULES,
      "You are an intelligent task management AI.",
      "CRITICAL: If the user already has a pending new task (title/details in history) and replies with only a time/date, combine that with the pending task and call create_notion_task (or update_notion_task if the task already exists). Do not invent dates.",
      "Use supplied tasks only when Aldo asks about tasks/deadlines or CURRENT TOPIC is task management; otherwise keep Active tasks silent in the reply text. Use explicit memory when relevant to the current topic.",
      "You have FULL control over task, note, and memory management via tools.",
      "Always use tools when the user asks to create, read, update, or delete tasks/notes/memory.",
      "Do not invent missing Notion data — especially due dates.",
      "When updating or creating a task's due date, use natural language (e.g., 'besok', 'minggu depan', '2026-09-08') ONLY when the user said it.",
      "MANDATORY: Jika membuat task tanpa tenggat dari user, setelah tool call tanyakan tenggatnya.",
      "TOOL SELECTION RULES:",
      "1. CREATING: If the context of the conversation is about a NEW task (e.g., the user just mentioned a new homework, or you just asked a clarifying question about a NEW task and the user answered), you MUST use `create_notion_task`.",
      "2. UPDATING: ONLY use `update_notion_task` if the user EXPLICITLY asks to change, move, or modify an ALREADY EXISTING task. Do NOT hallucinate or reuse a `taskId` for a new task. If the user wants to update a task but you don't know the ID, use `read_notion_tasks` first to find it.",
      "3. DELETING: Use `delete_notion_tasks` to archive or delete tasks.",
      "PARALLEL EXECUTION: If the user requests multiple clearly distinct actions in a single prompt (e.g., delete a task AND create a note), you MAY output MULTIPLE function calls simultaneously. Do NOT emit multiple create_notion_task calls for one topic unless the user explicitly listed multiple separate tasks.",
      "PARAMETER EXTRACTION RULES:",
      "When executing a tool call after a multi-turn clarification (e.g., creating a task after asking for a due date), you MUST look back at the conversation history to extract the ACTUAL task subject/title from the user's initial message.",
      "CRITICAL: NEVER use generic placeholder titles like 'Tugas baru', 'New Task', or 'Tugas'. If the user originally said 'Tugas matkul psikologi...', the `title` parameter MUST capture that exact intent. Do not be lazy.",
      "AGENTIC BEHAVIOR (MULTI-STEP RESOLUTION):",
      "If the user asks to delete or update a specific task (e.g., \"hapus tugas baru\"), but you do NOT possess the exact Notion UUIDs in your immediate conversation history, YOU MUST NOT GUESS OR HALLUCINATE THEM.",
      "Instead, your FIRST action must be to call `read_notion_tasks` to search the database. Only after you have retrieved the correct UUIDs from the read action, you may proceed to use `delete_notion_tasks` or `update_notion_task`. If your environment does not support recursive tool calling, simply read the tasks for the user first and ask them to confirm which ones to delete.",
      ...(projectsBlock ? [projectsBlock] : []),
      ...(goalsBlock ? [goalsBlock] : []),
      ...(context.projectsEnabled ? [PROJECTS_CRUD_RULES] : []),
      ...(context.goalsEnabled ? [GOALS_CRUD_RULES] : []),
      "\nActive tasks:\n" + (taskLines.length ? taskLines.join("\n") : "- none"),
      "\nExplicit memory:\n" + memoryBlock,
    ]),
    "Answer in concise Indonesian unless the user writes in another language.",
  ].join("\n");

  const inputText = isGroup
    ? userMessage.text
    : [userMessage.text, "Active tasks:", taskLines.length ? taskLines.join("\n") : "- none", "Explicit memory:", memoryBlock].join("\n\n");

  const toolDefs = isGroup ? [] : [
      {
        type: "function",
        name: "create_notion_task",
        description: "Creates a BRAND NEW task in Notion Tasks. Use when completing a new task after the user gave a missing deadline (e.g. replied 'Selasa'). If the user described task details across messages, put those details in content (Notes column). NEVER invent due_date — omit due_date when the user did not state a deadline, then ask for it in your reply text.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "CRITICAL: Short task title only (e.g. 'Instal Simurelay & instalasi listrik sederhana'). NOT the full multi-paragraph instructions — those go in content." },
            due_date: { type: "STRING", description: "HANYA jika user menyebut tenggat. Format YYYY-MM-DD atau frasa natural user ('besok', 'kamis depan'). JANGAN diisi kalau user tidak menyebut tanggal." },
            due_time: { type: "STRING", description: "Jam spesifik HH:mm. Isi HANYA JIKA user menyebutkan jam." },
            priority: { type: "STRING", enum: ["Low", "Medium", "High"] },
            content: { type: "STRING", description: "Detail/instruksi untuk kolom Notes di Tasks (boleh panjang: gabungan pesan user tentang tugas ini). Jangan buang detail penting." },
            project: { type: "STRING", description: "Exact or clear LIFE OS project name from Known projects list. Omit if none / user said without project." },
          },
          required: ["title", "priority"]
        }
      },
      {
        type: "function",
        name: "read_notion_tasks",
        description: "Requests the system to read and return the list of active tasks. You can optionally filter by status.",
        parameters: {
          type: "OBJECT",
          properties: {
            status: { type: "STRING", enum: ["To Do", "Doing", "Done"], description: "Optional filter by task status." }
          },
          required: []
        }
      },
      {
        type: "function",
        name: "create_notion_note",
        description: "Saves a general note, idea, or thought to the Notion Inbox.",
        parameters: {
          type: "OBJECT",
          properties: {
            title: { type: "STRING", description: "The content of the note." }
          },
          required: ["title"]
        }
      },
      {
        type: "function",
        name: "create_notion_memory",
        description: "Saves user profile data, preferences, or important facts to remember in the Notion Memory database.",
        parameters: {
          type: "OBJECT",
          properties: {
            key: { type: "STRING", description: "The topic or key fact." },
            value: { type: "STRING", description: "The detailed information to remember." },
            category: { type: "STRING", enum: ["Identity", "Preference", "Goal", "Project", "Pattern", "Other"] }
          },
          required: ["key", "value", "category"]
        }
      },
      {
        type: "function",
        name: "update_notion_task",
        description: "Updates an existing task in Notion with a new due date, priority, or status.",
        parameters: {
          type: "OBJECT",
          properties: {
            taskId: { type: "STRING", description: "The exact Notion page ID (UUID). CRITICAL: You MUST NOT guess, invent, or hallucinate this ID. If you do not have the exact ID provided by the user or from a previous read_notion_tasks call, YOU ARE FORBIDDEN from using this tool." },
            due_date: { type: "STRING", description: "Tanggal tenggat. Boleh format YYYY-MM-DD, atau frasa natural persis seperti ucapan user (contoh: 'kamis depan', 'kemarin hari minggu', 'besok')." },
            due_time: { type: "STRING", description: "Jam spesifik baru dalam format HH:mm (contoh: '13:15', '07:43'). Isi HANYA JIKA user menyebutkan jam." },
            priority: { type: "STRING", enum: ["Low", "Medium", "High"] },
            status: { type: "STRING", enum: ["To Do", "Doing", "Done"] }
          },
          required: ["taskId"]
        }
      },
      {
        type: "function",
        name: "delete_notion_tasks",
        description: "Use this tool to archive/delete tasks. You can provide multiple task IDs. NEVER use update_notion_task to archive or delete.",
        parameters: {
          type: "OBJECT",
          properties: {
            keywords: {
              type: "ARRAY",
              description: "Array of EXACT, very short substrings of the task titles. CRITICAL: Strip away conversational wrapper words. Use highly unique fragments. To delete EVERYTHING (all notes/tasks), do not use conversational words. You MUST send exactly ['ALL'].",
              items: { type: "STRING" }
            }
          },
          required: ["keywords"]
        }
      },
      {
        type: "function",
        name: "create_routine",
        description: "Gunakan tool ini HANYA JIKA user meminta untuk menambahkan jadwal rutinitas harian. Jangan gunakan untuk tugas biasa.",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama rutinitas, contoh: Mandi, Berangkat Kuliah" },
            time: { type: "STRING", description: "Waktu rutinitas dalam format HH:mm 24 jam murni, contoh: '09:38', '14:00'" }
          },
          required: ["name", "time"]
        }
      },
      {
        type: "function",
        name: "delete_notion_notes",
        description: "Use this tool to archive/delete notes from the Inbox. You can provide multiple note titles or keywords.",
        parameters: {
          type: "OBJECT",
          properties: {
            keywords: {
              type: "ARRAY",
              description: "Array of EXACT, very short substrings of the note titles. CRITICAL: Strip away conversational wrapper words. Use highly unique fragments. To delete EVERYTHING (all notes/tasks), do not use conversational words. You MUST send exactly ['ALL'].",
              items: { type: "STRING" }
            }
          },
          required: ["keywords"]
        }
      },
      {
        type: "function",
        name: "read_notion_notes",
        description: "Requests the system to read and return the list of notes in the Inbox.",
        parameters: {
          type: "OBJECT",
          properties: {},
          required: []
        }
      },
      {
        type: "function",
        name: "delete_notion_memory",
        description: "Use this tool to archive/delete memory records. You can provide multiple memory keys/topics.",
        parameters: {
          type: "OBJECT",
          properties: {
            keywords: {
              type: "ARRAY",
              description: "Array of EXACT, very short substrings of the memory keys. CRITICAL: Strip away conversational wrapper words. Use highly unique fragments. To delete EVERYTHING, you MUST send exactly ['ALL'].",
              items: { type: "STRING" }
            }
          },
          required: ["keywords"]
        }
      },
      {
        type: "function",
        name: "set_conversation_topic",
        description: "Updates the tracked conversation topic when Aldo clearly switched subject (e.g. from drone project to shopping). Do NOT call for deadline/time-only replies on the same task, short yes/no confirmations, or minor clarifications within the same topic.",
        parameters: {
          type: "OBJECT",
          properties: {
            topic: { type: "STRING", description: "Short label for the new topic (e.g. 'belanja kaos', 'drone project')." },
            reason: { type: "STRING", description: "Optional brief reason why the topic changed." }
          },
          required: ["topic"]
        }
      },
      ...(context.projectsEnabled ? [
        {
          type: "function",
          name: "create_notion_project",
          description: "Creates a new page in LIFE OS Projects. Use when Aldo asks to buat/tambah project. Optional goal links to a LIFE OS Goal (not Memory category Goal).",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Project title (property Project)." },
              area: { type: "STRING", description: "Optional Area (select/text name)." },
              deadline: { type: "STRING", description: "Optional deadline — natural language or ISO date." },
              goal: { type: "STRING", description: "Optional LIFE OS Goal name or id to link. Omit if none / user did not link a goal." },
            },
            required: ["name"]
          }
        },
        {
          type: "function",
          name: "update_notion_project",
          description: "Updates an existing LIFE OS Project (rename, area, deadline, optional goal link). Match by project name or id.",
          parameters: {
            type: "OBJECT",
            properties: {
              project: { type: "STRING", description: "Existing project name or id to match." },
              new_name: { type: "STRING", description: "Optional new project title." },
              area: { type: "STRING", description: "Optional new Area." },
              deadline: { type: "STRING", description: "Optional new deadline — natural language or ISO date." },
              goal: { type: "STRING", description: "Optional LIFE OS Goal name or id to link. Omit if not changing goal." },
            },
            required: ["project"]
          }
        },
        {
          type: "function",
          name: "delete_notion_project",
          description: "Requests archive/delete of a LIFE OS Project. System will ask Aldo to confirm ya/jangan — always call this tool when user wants to hapus project.",
          parameters: {
            type: "OBJECT",
            properties: {
              project: { type: "STRING", description: "Project name or id to archive after user confirms." },
            },
            required: ["project"]
          }
        },
      ] : []),
      ...(context.goalsEnabled ? [
        {
          type: "function",
          name: "create_notion_goal",
          description: "Creates a new page in LIFE OS Goals (measurable target with Area/Metric/Progress). Not Memory category Goal. Use when Aldo asks to buat/tambah goal.",
          parameters: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING", description: "Goal title (property Goal)." },
              area: { type: "STRING", description: "Optional Area." },
              metric: { type: "STRING", description: "Optional Metric." },
              progress: { type: "STRING", description: "Optional Progress value." },
              status: { type: "STRING", description: "Optional Status (e.g. Not started / In progress / Done)." },
              target_date: { type: "STRING", description: "Optional Target Date — natural language or ISO date." },
              notes: { type: "STRING", description: "Optional Notes." },
            },
            required: ["name"]
          }
        },
        {
          type: "function",
          name: "update_notion_goal",
          description: "Updates an existing LIFE OS Goal. Match by goal name or id.",
          parameters: {
            type: "OBJECT",
            properties: {
              goal: { type: "STRING", description: "Existing goal name or id to match." },
              new_name: { type: "STRING", description: "Optional new goal title." },
              area: { type: "STRING", description: "Optional new Area." },
              metric: { type: "STRING", description: "Optional new Metric." },
              progress: { type: "STRING", description: "Optional new Progress." },
              status: { type: "STRING", description: "Optional new Status." },
              target_date: { type: "STRING", description: "Optional new Target Date." },
              notes: { type: "STRING", description: "Optional new Notes." },
            },
            required: ["goal"]
          }
        },
        {
          type: "function",
          name: "delete_notion_goal",
          description: "Requests archive/delete of a LIFE OS Goal. System will ask Aldo to confirm ya/jangan — always call this tool when user wants to hapus goal; linked projects stay.",
          parameters: {
            type: "OBJECT",
            properties: {
              goal: { type: "STRING", description: "Goal name or id to archive after user confirms." },
            },
            required: ["goal"]
          }
        },
      ] : []),
    ];

  if (previousInteractionId) {
    // legacy support, generateContent does not use this natively
  }

  const parts: any[] = [{ text: inputText }];
  if (userMessage.imageBase64) {
    parts.push({ inlineData: { mimeType: "image/jpeg", data: userMessage.imageBase64 } });
  }
  if (userMessage.audioBase64) {
    parts.push({ inlineData: { mimeType: "audio/ogg", data: userMessage.audioBase64 } });
  }

  const requestPayload: Record<string, unknown> = {
    contents: [{
      role: "user",
      parts: parts
    }],
    systemInstruction: {
      role: "system",
      parts: [{ text: systemPrompt }]
    },
    generationConfig: { maxOutputTokens: 700 }
  };
  if (toolDefs.length > 0) {
    requestPayload.tools = [{
      functionDeclarations: toolDefs.map((t: any) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }];
  }
  
  const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
    body: JSON.stringify(requestPayload)
  });
  
  if (!response.ok) {
    const errTxt = await response.text();
    let safeMsg = errTxt.slice(0, 300);
    safeMsg = safeMsg.replace(/(ntn|secret)_[a-zA-Z0-9_-]+/gi, "<REDACTED>");
    safeMsg = safeMsg.replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "<REDACTED>");
    console.error(`Gemini API error: HTTP=${response.status} message=${safeMsg}`);
    
    let type: GeminiApiError["type"] = "UNKNOWN_ERROR";
    const msgLower = safeMsg.toLowerCase();
    if (response.status === 400 && (msgLower.includes("location is not supported") || msgLower.includes("current location"))) {
      type = "LOCATION_UNSUPPORTED";
    } else if (response.status === 429) {
      type = "RATE_LIMIT";
    } else if (response.status === 400 && (msgLower.includes("media") || msgLower.includes("inline data"))) {
      type = "MEDIA_ERROR";
    } else if (response.status === 503 || response.status === 504 || msgLower.includes("timeout")) {
      type = "TIMEOUT";
    }
    
    throw new GeminiApiError(`Gemini API failed: HTTP ${response.status} ${safeMsg}`, type);
  }
  
  return extractReply(await response.json());
}

export async function generateProactiveAlarm(
  config: AppConfig,
  tasksToRemind: TaskRecord[],
  context: { tasks: TaskRecord[]; memories: MemoryRecord[] },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const taskData = tasksToRemind.map(t => `- [${t.priority}] ${t.task} (Jatuh tempo: ${t.due})`).join("\n");
  const memoryBlock = formatMemoriesForPrompt(context.memories);
  
  const now = nowWib();
  const localNow = new Date(now.getTime() + 7 * 3600000);
  const timeLabel = getWibTimeLabel(localNow.getUTCHours());
  const todayStr = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth()+1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}T${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}:00+07:00 (${timeLabel})`;
  
  const systemPrompt = [
    YOUYOU_PERSONA,
    `Ini adalah daftar tugasnya yang harus diomeli sekarang: ${taskData}.`,
    `Waktu saat ini: ${todayStr}`,
    "Buatkan satu pesan singkat, manis, namun sangat tegas dan agak cerewet (omeli dia jika waktunya sudah mepet) agar Aldo segera menyelesaikannya.",
    "DILARANG KERAS menyebutkan tahun, tanggal persis, atau kata 'prioritas'. Sebutkan waktu dengan natural (misal: 'jam 10 malam nanti', 'sebentar lagi').",
    "PENTING: Ini adalah alarm otomatis dari sistem Cron Job. User TIDAK mengirim pesan apa-apa padamu. Kamu berinisiatif datang sendiri untuk mengomel. JANGAN PERNAH berkata seperti 'Kamu baru saja menyuruhku' atau 'Tumben kamu diam'.",
    "\nExplicit memory:\n" + memoryBlock
  ].join("\n");

  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: "Bangun dan berikan pesan pengingatmu sekarang!" }] }],
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      let safeMsg = errTxt.slice(0, 300).replace(/(ntn|secret)_[a-zA-Z0-9_-]+/gi, "<REDACTED>").replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "<REDACTED>");
      console.error(`Gemini API error (Proactive Alarm): HTTP=${response.status} message=${safeMsg}`);
      
      let type: GeminiApiError["type"] = "UNKNOWN_ERROR";
      const msgLower = safeMsg.toLowerCase();
      if (response.status === 400 && (msgLower.includes("location is not supported") || msgLower.includes("current location"))) {
        type = "LOCATION_UNSUPPORTED";
      } else if (response.status === 429) {
        type = "RATE_LIMIT";
      } else if (response.status === 400 && (msgLower.includes("media") || msgLower.includes("inline data"))) {
        type = "MEDIA_ERROR";
      } else if (response.status === 503 || response.status === 504 || msgLower.includes("timeout")) {
        type = "TIMEOUT";
      }
      throw new GeminiApiError(`Failed to generate alarm from Gemini: HTTP ${response.status} ${safeMsg}`, type);
    }
    
    const data = await response.json() as any;
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      text = text.trim().replace(/\*\*([^*]+)\*\*/g, "*$1*");
    }
    return text || "Hei, ada tugas yang harus kamu kerjakan sekarang!";
  } catch (error) {
    console.error("Proactive alarm generation failed:", error);
    return `[System] *Alarm Darurat Tuan Muda!* Waktu untuk salah satu tugasmu sudah mepet! Aku kesulitan menghubungimu dengan kata-kata bagus karena sinyal jelek, tapi kerjakan sekarang: ${taskData}`;
  }
}

export async function generateTaskBriefing(
  config: AppConfig,
  tasksForBriefing: TaskRecord[],
  context: { tasks: TaskRecord[]; memories: MemoryRecord[] },
  opts: { source: "cron" | "on_demand" },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (tasksForBriefing.length === 0) {
    return emptyBriefingReply();
  }

  const taskData = tasksForBriefing.map((t) => {
    const label = t.projectName?.trim() ? t.projectName.trim() : "Tanpa project";
    return `- [${label}] ${t.task}${t.due ? ` (Jatuh tempo: ${t.due})` : ""}`;
  }).join("\n");
  const taskTitles = tasksForBriefing.map(t => t.task).join(", ");
  const memoryBlock = formatMemoriesForPrompt(context.memories);

  const now = nowWib();
  const localNow = new Date(now.getTime() + 7 * 3600000);
  const timeLabel = getWibTimeLabel(localNow.getUTCHours());
  const todayStr = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth()+1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}T${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}:00+07:00 (${timeLabel})`;

  const sourceRules = opts.source === "cron"
    ? "PENTING: Ini adalah BRIEFING otomatis dari sistem Cron Job. User TIDAK mengirim pesan apa-apa padamu. Kamu berinisiatif datang sendiri. JANGAN PERNAH berkata seperti 'Kamu baru saja menyuruhku' atau seolah user meminta briefing."
    : "PENTING: Aldo meminta briefing tugas. Jawab permintaan itu dengan ringkas dan terstruktur.";

  const systemPrompt = [
    YOUYOU_PERSONA,
    "Ini adalah BRIEFING tugas (bukan alarm darurat). Buat pesan ringkas, terstruktur, sopan tapi tetap cerewet khas Youyou.",
    `Daftar tugas untuk dibrief (HANYA ini, jangan tambah atau mengarang):\n${taskData}`,
    `Waktu saat ini: ${todayStr}`,
    "List hanya tugas yang disupply. Jangan membuat tugas fiktif.",
    "Kelompokkan secara natural per project bila ada.",
    "DILARANG KERAS menyebutkan tahun, tanggal persis, atau kata 'prioritas'. Sebutkan waktu dengan natural (misal: 'hari ini', 'besok pagi', 'sebentar lagi').",
    sourceRules,
    "\nExplicit memory:\n" + memoryBlock,
  ].join("\n");

  const userPrompt = opts.source === "on_demand"
    ? "Berikan briefing tugasku sekarang!"
    : "Bangun dan berikan briefing tugas harianmu sekarang!";

  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      let safeMsg = errTxt.slice(0, 300).replace(/(ntn|secret)_[a-zA-Z0-9_-]+/gi, "<REDACTED>").replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "<REDACTED>");
      console.error(`Gemini API error (Task Briefing): HTTP=${response.status} message=${safeMsg}`);

      let type: GeminiApiError["type"] = "UNKNOWN_ERROR";
      const msgLower = safeMsg.toLowerCase();
      if (response.status === 400 && (msgLower.includes("location is not supported") || msgLower.includes("current location"))) {
        type = "LOCATION_UNSUPPORTED";
      } else if (response.status === 429) {
        type = "RATE_LIMIT";
      } else if (response.status === 400 && (msgLower.includes("media") || msgLower.includes("inline data"))) {
        type = "MEDIA_ERROR";
      } else if (response.status === 503 || response.status === 504 || msgLower.includes("timeout")) {
        type = "TIMEOUT";
      }
      throw new GeminiApiError(`Failed to generate briefing from Gemini: HTTP ${response.status} ${safeMsg}`, type);
    }

    const data = await response.json() as any;
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      text = text.trim().replace(/\*\*([^*]+)\*\*/g, "*$1*");
    }
    return text || `Briefing tugas: ${taskTitles}`;
  } catch (error) {
    console.error("Task briefing generation failed:", error);
    return `[System] *Briefing Tuan Muda* Aku kesulitan menghubungimu dengan kata-kata bagus karena sinyal jelek, tapi ini tugas yang perlu kamu perhatikan: ${taskTitles}`;
  }
}

export async function generateRoutineAlarm(
  config: AppConfig,
  routinesToRemind: RoutineRecord[],
  context: { tasks: TaskRecord[]; memories: MemoryRecord[] },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const routineData = routinesToRemind.map(r => `- ${r.name} pada jam ${r.time}`).join("\n");
  const memoryBlock = formatMemoriesForPrompt(context.memories);
  const now = nowWib();
  const localNow = new Date(now.getTime() + 7 * 3600000);
  const timeLabel = getWibTimeLabel(localNow.getUTCHours());
  const todayStr = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth()+1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}T${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}:00+07:00 (${timeLabel})`;
  
  const systemPrompt = [
    YOUYOU_PERSONA,
    `Aldo memiliki rutinitas harian:\n${routineData}\n`,
    `Waktu sekarang: ${todayStr}.`,
    "Omelan kamu harus natural. Berikan alasan logis tapi cerewet kenapa dia harus melakukan itu (contoh: jika mandi, ancam dia soal bau badan; jika tidur, soal kesehatan, dll).",
    "Jangan sebut tanggal/tahun.",
    "PENTING: Ini adalah alarm otomatis dari sistem Cron Job. User TIDAK mengirim pesan apa-apa padamu. Kamu berinisiatif datang sendiri untuk mengomel. JANGAN PERNAH berkata seperti 'Kamu baru saja menyuruhku' atau 'Tumben kamu diam'.",
    "\nExplicit memory:\n" + memoryBlock
  ].join("\n");

  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": config.geminiApiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ 
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: "Bangun dan ingatkan aku soal rutinitas ini sekarang!" }] }],
      }),
    });

    if (!response.ok) {
      const errTxt = await response.text();
      let safeMsg = errTxt.slice(0, 300).replace(/(ntn|secret)_[a-zA-Z0-9_-]+/gi, "<REDACTED>").replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "<REDACTED>");
      console.error(`Gemini API error (Routine Alarm): HTTP=${response.status} message=${safeMsg}`);
      
      let type: GeminiApiError["type"] = "UNKNOWN_ERROR";
      const msgLower = safeMsg.toLowerCase();
      if (response.status === 400 && (msgLower.includes("location is not supported") || msgLower.includes("current location"))) {
        type = "LOCATION_UNSUPPORTED";
      } else if (response.status === 429) {
        type = "RATE_LIMIT";
      } else if (response.status === 400 && (msgLower.includes("media") || msgLower.includes("inline data"))) {
        type = "MEDIA_ERROR";
      } else if (response.status === 503 || response.status === 504 || msgLower.includes("timeout")) {
        type = "TIMEOUT";
      }
      throw new GeminiApiError(`Failed to generate routine alarm from Gemini: HTTP ${response.status} ${safeMsg}`, type);
    }
    
    const data = await response.json() as any;
    let text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      text = text.trim().replace(/\*\*([^*]+)\*\*/g, "*$1*");
    }
    return text || "Hei, ini waktunya rutinitas harianmu!";
  } catch (error) {
    console.error("Routine alarm generation failed:", error);
    return `[System] *Alarm Darurat Rutinitas!* Tuan Muda Aldo, sudah waktunya rutinitas harianmu! Aku sedang sibuk, jadi kerjakan sekarang!`;
  }
}
