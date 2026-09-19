import type { AppConfig, MemoryRecord, TaskRecord, RoutineRecord } from "./types";
import { nowWib, getWibTimeLabel } from "./date";

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

export async function generateChatReply(
  config: AppConfig,
  userMessage: { text: string; imageBase64?: string; audioBase64?: string },
  context: { tasks: TaskRecord[]; memories: MemoryRecord[]; chatContext?: "dm" | "group" },
  previousInteractionId?: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatReply> {
  const isGroup = context.chatContext === "group";
  const taskLines = isGroup
    ? []
    : context.tasks.slice(0, 10).map((task) => `- [ID: ${task.id}] [${task.priority}] ${task.task}${task.due ? ` (due ${task.due})` : ""}`);
  const memoryLines = isGroup
    ? []
    : context.memories.slice(0, 10).map((memory) => `- ${memory.key}: ${memory.value}`);
  
  const now = nowWib();
  const localNow = new Date(now.getTime() + 7 * 3600000);
  const timeLabel = getWibTimeLabel(localNow.getUTCHours());
  const todayStr = `${localNow.getUTCFullYear()}-${String(localNow.getUTCMonth()+1).padStart(2, '0')}-${String(localNow.getUTCDate()).padStart(2, '0')}T${String(localNow.getUTCHours()).padStart(2, '0')}:${String(localNow.getUTCMinutes()).padStart(2, '0')}:00+07:00 (${timeLabel})`;
  const systemPrompt = [
    `Waktu saat ini (WIB): ${todayStr}`,
    YOUYOU_PERSONA,
    ...(isGroup ? [GROUP_CHAT_RULES] : [
      BRAIN_V1_RULES,
      "You are an intelligent task management AI.",
      "CRITICAL: If the user already has a pending new task (title/details in history) and replies with only a time/date, combine that with the pending task and call create_notion_task (or update_notion_task if the task already exists). Do not invent dates.",
      "Use supplied tasks and explicit memory when relevant.",
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
      "\nActive tasks:\n" + (taskLines.length ? taskLines.join("\n") : "- none"),
      "\nExplicit memory:\n" + (memoryLines.length ? memoryLines.join("\n") : "- none"),
    ]),
    "Answer in concise Indonesian unless the user writes in another language.",
  ].join("\n");

  const inputText = isGroup
    ? userMessage.text
    : [userMessage.text, "Active tasks:", taskLines.length ? taskLines.join("\n") : "- none", "Explicit memory:", memoryLines.length ? memoryLines.join("\n") : "- none"].join("\n\n");

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
            content: { type: "STRING", description: "Detail/instruksi untuk kolom Notes di Tasks (boleh panjang: gabungan pesan user tentang tugas ini). Jangan buang detail penting." }
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
            category: { type: "STRING", enum: ["Profile", "Preference", "Project", "Other"] }
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
      }
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
  const memoryLines = context.memories.slice(0, 10).map((memory) => `- ${memory.key}: ${memory.value}`);
  
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
    "\nExplicit memory:\n" + (memoryLines.length ? memoryLines.join("\n") : "- none")
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

export async function generateRoutineAlarm(
  config: AppConfig,
  routinesToRemind: RoutineRecord[],
  context: { tasks: TaskRecord[]; memories: MemoryRecord[] },
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const routineData = routinesToRemind.map(r => `- ${r.name} pada jam ${r.time}`).join("\n");
  const memoryLines = context.memories.slice(0, 10).map((memory) => `- ${memory.key}: ${memory.value}`);
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
    "\nExplicit memory:\n" + (memoryLines.length ? memoryLines.join("\n") : "- none")
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
