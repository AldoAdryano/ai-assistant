import { describe, expect, it, vi } from "vitest";
import type { AppConfig, Env, MemoryRecord, TaskRecord } from "../src/types";
import { handleUserMessage, type RouterDeps } from "../src/router";
import { NotionRejectionError } from "../src/notion";
import { GeminiApiError } from "../src/gemini";
import { emptyBriefingReply } from "../src/task-intelligence";

const config = {} as AppConfig;
const env = {} as Env;

function deps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    createNote: vi.fn(async () => "note-id"),
    createTask: vi.fn(async () => "task-id"),
    listActiveTasks: vi.fn(async (): Promise<TaskRecord[]> => []),
    listProjects: vi.fn(async () => []),
    getAllTasks: vi.fn(async (): Promise<TaskRecord[]> => []),
    getAllNotes: vi.fn(async (): Promise<Array<{ id: string; title: string }>> => []),
    upsertMemory: vi.fn(async () => "memory-id"),
    recallMemory: vi.fn(async (): Promise<MemoryRecord[]> => []),
    listMemoryContext: vi.fn(async (): Promise<MemoryRecord[]> => []),
    getAllMemory: vi.fn(async (): Promise<MemoryRecord[]> => []),
    updateTask: vi.fn(async () => undefined),
    archiveTask: vi.fn(async () => undefined),
    archiveProject: vi.fn(async () => undefined),
    createProject: vi.fn(async () => "proj-new"),
    updateProject: vi.fn(async () => undefined),
    listGoals: vi.fn(async () => []),
    createGoal: vi.fn(async () => "goal-new"),
    updateGoal: vi.fn(async () => undefined),
    archiveGoal: vi.fn(async () => undefined),
    addRoutine: vi.fn(async () => 'routine-id'),
    generateChatReply: vi.fn(async () => ({ type: "text", text: "Jawaban AI" }) as any),
    parseIndonesianDeadline: vi.fn(() => ({ kind: "none" })) as any,
    parseIndonesianNaturalDate: vi.fn(() => null) as any,
    getInteractionId: vi.fn(async () => null),
    saveInteractionId: vi.fn(async () => undefined),
    getChatLog: vi.fn(async () => null),
    saveChatLog: vi.fn(async () => undefined),
    clearMemory: vi.fn(async () => undefined),
    getPendingDelete: vi.fn(async () => null),
    savePendingDelete: vi.fn(async () => undefined),
    clearPendingDelete: vi.fn(async () => undefined),
    getPendingMemory: vi.fn(async () => null),
    savePendingMemory: vi.fn(async () => undefined),
    clearPendingMemory: vi.fn(async () => undefined),
    getConversationContext: vi.fn(async () => null),
    saveConversationContext: vi.fn(async () => undefined),
    clearConversationContext: vi.fn(async () => undefined),
    generateTaskBriefing: vi.fn(async () => "Briefing AI"),
    ...overrides,
  };
}

describe("handleUserMessage (AI-Driven)", () => {
  it("bypasses Gemini and returns HELP text on /start", async () => {
    const d = deps();
    const reply = await handleUserMessage(env, 123, config, { text: "/start" }, d);
    expect(reply).toContain("Perintah V1 (AI-Driven):");
    expect(d.generateChatReply).not.toHaveBeenCalled();
  });

  it("handles standard text reply from Gemini", async () => {
    const d = deps({
      generateChatReply: vi.fn(async () => ({ type: "text", text: "Halo! Ada yang bisa dibantu?" })) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Halo" }, d);
    expect(d.generateChatReply).toHaveBeenCalled();
    expect(reply).toBe("Halo! Ada yang bisa dibantu?");
  });

  it("group mode skips personal tasks/memory tools", async () => {
    const d = deps({
      generateChatReply: vi.fn(async (_c, _m, ctx) => {
        expect(ctx.chatContext).toBe("group");
        expect(ctx.tasks).toEqual([]);
        expect(ctx.memories).toEqual([]);
        return { type: "text", text: "Hai di grup" };
      }) as any,
    });
    const reply = await handleUserMessage(env, "wa-group:120@g.us", config, {
      text: "@Youyou hey",
      chatContext: "group",
    }, d);
    expect(reply).toBe("Hai di grup");
    expect(d.listActiveTasks).not.toHaveBeenCalled();
    expect(d.listMemoryContext).not.toHaveBeenCalled();
    expect(d.createTask).not.toHaveBeenCalled();
  });

  it("handles create_notion_task tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_task", args: { title: "Beli susu", priority: "High", due_date: "besok", content: "Di minimarket" } }]
        })
        .mockResolvedValue({ type: "text", text: "Tugas sudah ditambahkan dengan prioritas High" }) as any,
      parseIndonesianDeadline: vi.fn((text) => {
        if (text === "deadline besok") return { kind: "resolved", due: "2026-09-02" };
        return { kind: "none" };
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Tolong ingatkan beli susu besok" }, d);
    expect(d.parseIndonesianDeadline).toHaveBeenCalledWith("deadline besok");
    expect(d.createTask).toHaveBeenCalledWith(config, { task: "Beli susu", priority: "High", due_date: "2026-09-02", notes: "Di minimarket" });
    expect(reply).toContain("Tugas 'Beli susu' sudah ditambahkan dengan prioritas High");
  });

  it("strips invented due_date when user never mentioned a deadline and asks for tenggat", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{
            name: "create_notion_task",
            args: {
              title: "Instal Simurelay",
              priority: "High",
              due_date: "2026-09-22",
              content: "instal di hp\nbuat instalasi listrik\nscreenshoot ke grup",
            },
          }],
        })
        .mockResolvedValue({ type: "text", text: "ok" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, {
      text: "ini materi pertama coba aplikasi simurelay\ninstal di hp buat instalasi listrik\nscreenshoot laporan ke grup",
    }, d);
    expect(d.createTask).toHaveBeenCalledWith(config, {
      task: "Instal Simurelay",
      priority: "High",
      notes: "instal di hp\nbuat instalasi listrik\nscreenshoot ke grup",
    });
    expect(reply).toMatch(/tenggat/i);
  });

  it("handles create_notion_task missing date clarification", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_task", args: { title: "Beli susu", priority: "Medium", due_date: "minggu depan" } }]
        })
        .mockResolvedValue({ type: "text", text: "Hari apa minggu depan?" }) as any,
      parseIndonesianDeadline: vi.fn((text) => {
        if (text === "deadline minggu depan") return { kind: "needs_clarification", reason: "missing_weekday" };
        return { kind: "none" };
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Tolong ingatkan beli susu minggu depan" }, d);
    expect(d.createTask).not.toHaveBeenCalled();
    expect(reply).toContain("Hari apa minggu depan?");
  });

  it("handles read_notion_tasks tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "read_notion_tasks", args: {} }]
        })
        .mockResolvedValue({ type: "text", text: "1. [High] Tugas satu — 2026-09-05" }) as any,
      listActiveTasks: vi.fn(async () => [
        { id: "1", task: "Tugas satu", status: "To Do", priority: "High", due: "2026-09-05" }
      ]) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Cek status tugas aktif di Notion" }, d);
    expect(reply).toContain("1. [High] Tugas satu — 2026-09-05");
  });

  it("handles create_notion_note tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_note", args: { title: "Ide aplikasi baru" } }]
        })
        .mockResolvedValue({ type: "text", text: "Sudah saya simpan ke Inbox" }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Catat ide aplikasi baru" }, d);
    expect(d.createNote).toHaveBeenCalledWith(config, { text: "Ide aplikasi baru", noteType: "Note" });
    expect(reply).toContain("Catatan 'Ide aplikasi baru' sudah disimpan");
  });

  it("handles create_notion_memory tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_memory", args: { key: "Makanan favorit", value: "Nasi goreng", category: "Preference" } }]
        })
        .mockResolvedValue({ type: "text", text: "Sudah saya simpan ke Memory" }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Ingat bahwa makanan favorit saya nasi goreng" }, d);
    expect(d.upsertMemory).toHaveBeenCalledWith(config, { key: "Makanan favorit", value: "Nasi goreng", category: "Preference" });
    expect(reply).toContain("Memori 'Makanan favorit' sudah disimpan");
  });

  it("handles update_notion_task tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "update_notion_task", args: { taskId: "task-123", due_date: "selasa depan" } }]
        })
        .mockResolvedValue({ type: "text", text: "Tugas berhasil diperbarui" }) as any,
      parseIndonesianDeadline: vi.fn((text) => {
        if (text === "deadline selasa depan") return { kind: "resolved", due: "2026-09-08" };
        return { kind: "none" };
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Ubah jadwal jadi selasa depan" }, d);
    expect(d.updateTask).toHaveBeenCalledWith(config, "task-123", { taskId: "task-123", due_date: "2026-09-08" });
    expect(reply).toContain("Tugas berhasil diperbarui");
  });

  it("handles delete_notion_tasks tool call", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "delete_notion_tasks", args: { keywords: ["ALL"] } }]
        })
        .mockResolvedValue({ type: "text", text: "Tugas dihapus" }) as any,
      getAllTasks: vi.fn(async () => [
        { id: "task-1", task: "hapus tugas 1", status: "To Do", priority: "High", due: "2026-09-05" },
        { id: "task-2", task: "hapus tugas 2", status: "To Do", priority: "High", due: "2026-09-05" }
      ]) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Hapus tugas 1 dan 2" }, d);
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.savePendingDelete).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({
        kind: "tasks",
        ids: ["task-1", "task-2"],
        summary: expect.stringContaining("hapus tugas 1"),
      }),
    );
    expect(reply).toMatch(/yakin|ya|jangan/i);
    expect(reply).toMatch(/2/);
    expect(reply).toContain("hapus tugas 1");
    expect(reply).not.toMatch(/\(\d+ tugas\)/);
  });

  it("archives pending delete when user confirms with ya", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1", "task-2"],
        summary: "hapus tugas 1, hapus tugas 2",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.archiveTask).toHaveBeenCalledTimes(2);
    expect(d.archiveTask).toHaveBeenCalledWith(config, "task-1");
    expect(d.archiveTask).toHaveBeenCalledWith(config, "task-2");
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/2|berhasil|hapus/i);
  });

  it("archives pending project delete via archiveProject on ya", async () => {
    const projectsConfig = { notionProjectsDataSourceId: "projects-ds" } as AppConfig;
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "project" as const,
        ids: ["proj-1"],
        summary: "Life OS",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, projectsConfig, { text: "ya" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.archiveProject).toHaveBeenCalledTimes(1);
    expect(d.archiveProject).toHaveBeenCalledWith(projectsConfig, "proj-1");
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/berhasil menghapus 1 project/i);
  });

  it("archives pending goal delete via archiveGoal on ya", async () => {
    const goalsConfig = { notionGoalsDataSourceId: "goals-ds" } as AppConfig;
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "goal" as const,
        ids: ["goal-1"],
        summary: "Ship Life OS",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, goalsConfig, { text: "ya" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.archiveProject).not.toHaveBeenCalled();
    expect(d.archiveGoal).toHaveBeenCalledTimes(1);
    expect(d.archiveGoal).toHaveBeenCalledWith(goalsConfig, "goal-1");
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/berhasil menghapus 1 goal/i);
  });

  it("confirm ya for pending goal delete clears without archive when goals not configured", async () => {
    const disabledConfig = { notionGoalsDataSourceId: null } as AppConfig;
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "goal" as const,
        ids: ["goal-1"],
        summary: "Ship Life OS",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, disabledConfig, { text: "ya" }, d);
    expect(d.archiveGoal).not.toHaveBeenCalled();
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(reply).toContain("Goals belum dikonfigurasi.");
  });

  it("cancels pending delete when user says jangan", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1"],
        summary: "hapus tugas 1",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "jangan" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/batal|cancel|tidak dihapus|ok/i);
  });

  it("cancels pending delete on jangan hapus without archiving", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1", "task-2"],
        summary: "A, B",
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "jangan hapus" }, d);
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(reply).toMatch(/batal|tidak dihapus|ok/i);
  });

  it("stale pending delete does not archive on ya and falls through to Gemini", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1"],
        summary: "A",
        createdAt: Date.now() - 11 * 60 * 1000,
      })),
      generateChatReply: vi.fn(async () => ({ type: "text", text: "Halo dari Gemini" })) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(d.generateChatReply).toHaveBeenCalled();
    expect(reply).toBe("Halo dari Gemini");
  });

  it("keeps pending when all archives fail", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1", "task-2"],
        summary: "A, B",
        createdAt: Date.now(),
      })),
      archiveTask: vi.fn(async () => {
        throw new Error("notion down");
      }),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.clearPendingDelete).not.toHaveBeenCalled();
    expect(reply).toMatch(/gagal/i);
    expect(reply).toMatch(/2/);
  });

  it("reports partial archive success and clears pending", async () => {
    let calls = 0;
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1", "task-2"],
        summary: "A, B",
        createdAt: Date.now(),
      })),
      archiveTask: vi.fn(async () => {
        calls++;
        if (calls === 1) return;
        throw new Error("fail");
      }),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/berhasil menghapus 1/i);
    expect(reply).toMatch(/gagal 1/i);
  });

  it("only first delete tool in a turn creates pending", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [
            { name: "delete_notion_tasks", args: { keywords: ["ALL"] } },
            { name: "delete_notion_notes", args: { keywords: ["ALL"] } },
          ],
        }) as any,
      getAllTasks: vi.fn(async () => [
        { id: "task-1", task: "Tugas A", status: "To Do", priority: "High", due: undefined },
      ]) as any,
      getAllNotes: vi.fn(async () => [
        { id: "note-1", title: "Catatan B" },
      ]) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "hapus semua" }, d);
    expect(d.savePendingDelete).toHaveBeenCalledTimes(1);
    expect(d.savePendingDelete).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({ kind: "tasks", summary: expect.stringContaining("Tugas A") }),
    );
    expect(reply).toMatch(/satu batch|konfirmasi/i);
  });

  it("allows multi-create when user replies beberapa after clarify", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [1, 2, 3].map((i) => ({
            name: "create_notion_task",
            args: { title: `Item ${i}`, priority: "Medium" },
          })),
        }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "beberapa" }, d);
    expect(d.createTask).toHaveBeenCalledTimes(3);
    expect(reply).toContain("Item 1");
  });

  it("blocks multiple create_notion_task in one turn without explicit multi", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [1, 2, 3, 4].map((i) => ({
            name: "create_notion_task",
            args: { title: `Simurelay ${i}`, priority: "Medium" },
          })),
        })
        .mockResolvedValue({ type: "text", text: "ok" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, {
      text: "Simurelay error\ncek board\nfix wiring\ntest ulang",
    }, d);
    expect(d.createTask).not.toHaveBeenCalled();
    expect(reply).toMatch(/satu|beberapa/i);
  });

  it("text-only Gemini reply never writes to Notion", async () => {
    const d = deps({
      generateChatReply: vi.fn(async () => ({
        type: "text",
        text: "Aldo, mau jadi satu tugas atau beberapa?",
      })) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Simurelay error lagi" }, d);
    expect(d.createTask).not.toHaveBeenCalled();
    expect(d.archiveTask).not.toHaveBeenCalled();
    expect(reply).toMatch(/satu|beberapa/i);
  });

  it("handles NotionRejectionError for createTask", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_task", args: { title: "Beli susu", priority: "High" } }]
        })
        .mockResolvedValue({ type: "text", text: "Notion menolak" }) as any,
      createTask: vi.fn().mockRejectedValue(new NotionRejectionError("Invalid column"))
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Tolong tambahkan tugas" }, d);
    expect(reply).toContain("Notion menolak");
  });

  it("Test B: retries on LOCATION_UNSUPPORTED and succeeds", async () => {
    let attempts = 0;
    const d = deps({
      generateChatReply: vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new GeminiApiError("Location err", "LOCATION_UNSUPPORTED");
        }
        return { type: "text", text: "Berhasil setelah retry" };
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Halo" }, d);
    expect(attempts).toBe(3);
    expect(reply).toBe("Berhasil setelah retry");
  });

  it("Test C: retries on RATE_LIMIT then soft-fails", async () => {
    let attempts = 0;
    const d = deps({
      generateChatReply: vi.fn(async () => {
        attempts++;
        throw new GeminiApiError("Rate limit", "RATE_LIMIT");
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Halo" }, d);
    expect(attempts).toBe(5);
    expect(reply).toContain("nge-lag");
  });

  it("Test D: falls back to text-only after media LOCATION failures", async () => {
    let attempts = 0;
    const d = deps({
      generateChatReply: vi.fn(async (cfg, payload) => {
        attempts++;
        if (attempts <= 2) {
          expect(payload.imageBase64).toBe("base64data");
          throw new GeminiApiError("Location unsupported", "LOCATION_UNSUPPORTED");
        }
        // later attempts should drop media
        expect(payload.imageBase64).toBeUndefined();
        return { type: "text", text: "Fallback text response" };
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Gambar ini", imageBase64: "base64data" }, d);
    expect(attempts).toBeGreaterThanOrEqual(3);
    expect(reply).toBe("Fallback text response");
  });

  it("Test E: idempotency prevents duplicate tool execution", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [
            { name: "create_notion_task", args: { title: "Tugas sama", priority: "High" } },
            { name: "create_notion_task", args: { title: "Tugas sama", priority: "High" } }
          ]
        }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "buat 2 tugas: Tugas sama" }, d);
    expect(d.createTask).toHaveBeenCalledTimes(1); // Should only execute once due to duplicate check
    expect(reply).toContain("Tugas 'Tugas sama' sudah ditambahkan");
  });

  it("keeps yesterday's health context instead of truncating chat history to 1500 chars", async () => {
    const prefix = "CRITICAL_MEMORY: Aldo pilek tenggorokan serek kepala pusing nafas panas.\n";
    const filler = "User: spam\nBot: ok\n".repeat(200);
    const longHistory = prefix + filler;
    expect(longHistory.length).toBeGreaterThan(1500);

    let savedLog = "";
    const d = deps({
      getChatLog: vi.fn(async () => longHistory),
      saveChatLog: vi.fn(async (_env, _id, log) => { savedLog = log; }),
    });
    await handleUserMessage(env, 123, config, { text: "Inget ga kemaren aku sakit apa?" }, d);
    expect(savedLog).toContain("Aldo pilek tenggorokan serek kepala pusing nafas panas");
    expect(savedLog.length).toBeGreaterThan(1500);
  });

  it("Test F: soft Youyou fallback on final LOCATION_UNSUPPORTED failure", async () => {
    const d = deps({
      generateChatReply: vi.fn(async () => {
        throw new GeminiApiError("Location err", "LOCATION_UNSUPPORTED");
      }) as any
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Gagal terus" }, d);
    expect(reply).toContain("nge-lag");
    expect(reply).not.toContain("koneksi AI");
  });

  it("explicit ingat bahwa + create Identity upserts immediately without pending", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_memory", args: { key: "Kuliah", value: "UNY", category: "Identity" } }],
        })
        .mockResolvedValue({ type: "text", text: "Ok" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "Ingat bahwa kuliah saya di UNY" }, d);
    expect(d.upsertMemory).toHaveBeenCalledTimes(1);
    expect(d.upsertMemory).toHaveBeenCalledWith(config, { key: "Kuliah", value: "UNY", category: "Identity" });
    expect(d.savePendingMemory).not.toHaveBeenCalled();
    expect(reply).toContain("Memori 'Kuliah' sudah disimpan");
  });

  it("inferred create_notion_memory saves pending and proposes confirm", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_memory", args: { key: "Kuliah", value: "UNY", category: "Identity" } }],
        })
        .mockResolvedValue({ type: "text", text: "Ok" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "aku kuliah di UNY" }, d);
    expect(d.upsertMemory).not.toHaveBeenCalled();
    expect(d.savePendingMemory).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({ key: "Kuliah", value: "UNY", category: "Identity" }),
    );
    expect(reply).toMatch(/ingat|ya|jangan/i);
  });

  it("pending memory + ya upserts pending fields and skips Gemini", async () => {
    const d = deps({
      getPendingMemory: vi.fn(async () => ({
        key: "Kuliah",
        value: "UNY",
        category: "Identity" as const,
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.upsertMemory).toHaveBeenCalledWith(config, { key: "Kuliah", value: "UNY", category: "Identity" });
    expect(d.clearPendingMemory).toHaveBeenCalledWith(env, 123);
    expect(reply).toMatch(/ingat|simpan|memori|Kuliah|UNY/i);
  });

  it("pending memory + jangan clears without upsert", async () => {
    const d = deps({
      getPendingMemory: vi.fn(async () => ({
        key: "Kuliah",
        value: "UNY",
        category: "Identity" as const,
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "jangan" }, d);
    expect(d.upsertMemory).not.toHaveBeenCalled();
    expect(d.clearPendingMemory).toHaveBeenCalledWith(env, 123);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(reply).toMatch(/batal|ok|tidak/i);
  });

  it("Pattern + explicit ingat still requires confirm", async () => {
    const d = deps({
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "create_notion_memory", args: { key: "Procrastinate", value: "sering menunda", category: "Pattern" } }],
        })
        .mockResolvedValue({ type: "text", text: "Ok" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ingat bahwa saya sering menunda" }, d);
    expect(d.upsertMemory).not.toHaveBeenCalled();
    expect(d.savePendingMemory).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({ key: "Procrastinate", value: "sering menunda", category: "Pattern" }),
    );
    expect(reply).toMatch(/ingat|ya|jangan/i);
  });

  it("pending delete wins over pending memory on ya", async () => {
    const d = deps({
      getPendingDelete: vi.fn(async () => ({
        kind: "tasks" as const,
        ids: ["task-1"],
        summary: "A",
        createdAt: Date.now(),
      })),
      getPendingMemory: vi.fn(async () => ({
        key: "Kuliah",
        value: "UNY",
        category: "Identity" as const,
        createdAt: Date.now(),
      })),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "ya" }, d);
    expect(d.archiveTask).toHaveBeenCalledWith(config, "task-1");
    expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
    expect(d.upsertMemory).not.toHaveBeenCalled();
    expect(d.clearPendingMemory).not.toHaveBeenCalled();
    expect(reply).toMatch(/berhasil|hapus/i);
  });

  it("explicit phrase pindah topik saves conversation context with previous preserved", async () => {
    const prior = {
      currentTopic: "drone FPV",
      previousTopic: null as string | null,
      activeTaskHint: "beli drone",
      updatedAt: 1,
    };
    const d = deps({
      getConversationContext: vi.fn(async () => prior),
      generateChatReply: vi.fn(async () => ({ type: "text", text: "Ok belanja kaos" })) as any,
    });
    await handleUserMessage(env, 123, config, { text: "pindah topik belanja kaos" }, d);
    expect(d.saveConversationContext).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({
        currentTopic: expect.stringMatching(/belanja\s*kaos/i),
        previousTopic: "drone FPV",
        activeTaskHint: null,
      }),
    );
    expect(d.generateChatReply).toHaveBeenCalledWith(
      config,
      expect.anything(),
      expect.objectContaining({
        conversation: expect.objectContaining({
          currentTopic: expect.stringMatching(/belanja\s*kaos/i),
          previousTopic: "drone FPV",
        }),
      }),
      null,
    );
  });

  it("deadline-only besok does not save conversation context via phrase path", async () => {
    const d = deps({
      getConversationContext: vi.fn(async () => ({
        currentTopic: "drone FPV",
        previousTopic: null,
        activeTaskHint: null,
        updatedAt: 1,
      })),
      generateChatReply: vi.fn(async () => ({ type: "text", text: "Ok besok" })) as any,
    });
    await handleUserMessage(env, 123, config, { text: "besok" }, d);
    expect(d.saveConversationContext).not.toHaveBeenCalled();
  });

  it("phrase switch then set_conversation_topic in same turn keeps original previousTopic", async () => {
    const prior = {
      currentTopic: "drone FPV",
      previousTopic: null as string | null,
      activeTaskHint: "beli drone",
      updatedAt: 1,
    };
    const d = deps({
      getConversationContext: vi.fn(async () => prior),
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "set_conversation_topic", args: { topic: "belanja kaos", reason: "user switched" } }],
        })
        .mockResolvedValue({ type: "text", text: "Ok belanja kaos" }) as any,
    });
    await handleUserMessage(env, 123, config, { text: "pindah topik belanja" }, d);
    expect(d.saveConversationContext).toHaveBeenCalledTimes(1);
    expect(d.saveConversationContext).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({
        currentTopic: "belanja",
        previousTopic: "drone FPV",
      }),
    );
  });

  it("set_conversation_topic tool saves conversation context", async () => {
    const prior = {
      currentTopic: "drone FPV",
      previousTopic: null as string | null,
      activeTaskHint: null,
      updatedAt: 1,
    };
    const d = deps({
      getConversationContext: vi.fn(async () => prior),
      generateChatReply: vi.fn()
        .mockResolvedValueOnce({
          type: "function_calls",
          calls: [{ name: "set_conversation_topic", args: { topic: "belanja kaos", reason: "user switched" } }],
        })
        .mockResolvedValue({ type: "text", text: "Sip, belanja kaos ya" }) as any,
    });
    const reply = await handleUserMessage(env, 123, config, { text: "mau belanja kaos aja" }, d);
    expect(d.saveConversationContext).toHaveBeenCalledWith(
      env,
      123,
      expect.objectContaining({
        currentTopic: "belanja kaos",
        previousTopic: "drone FPV",
      }),
    );
    expect(reply).toContain("belanja kaos");
  });

  it("group mode never loads or saves conversation context", async () => {
    const d = deps({
      generateChatReply: vi.fn(async (_c, _m, ctx) => {
        expect(ctx.conversation == null).toBe(true);
        return { type: "text", text: "Hai di grup" };
      }) as any,
    });
    await handleUserMessage(env, "wa-group:120@g.us", config, {
      text: "pindah topik belanja kaos",
      chatContext: "group",
    }, d);
    expect(d.getConversationContext).not.toHaveBeenCalled();
    expect(d.saveConversationContext).not.toHaveBeenCalled();
  });

  it("DM briefing short-circuits to generateTaskBriefing with Filter-B subset", async () => {
    const overdue = { id: "o1", task: "Overdue A", status: "To Do", priority: "Medium", due: "2026-09-01" } as TaskRecord;
    const far = { id: "f1", task: "Far B", status: "To Do", priority: "Medium", due: "2026-12-01" } as TaskRecord;
    const memories = [{ id: "m1", key: "kota", value: "Jakarta", category: "Preference" }] as MemoryRecord[];
    const d = deps({
      listActiveTasks: vi.fn(async () => [overdue, far]),
      listMemoryContext: vi.fn(async () => memories),
      generateTaskBriefing: vi.fn(async () => "Ringkasan tugas"),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "briefing" }, d);
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.generateTaskBriefing).toHaveBeenCalledTimes(1);
    expect(d.generateTaskBriefing).toHaveBeenCalledWith(
      config,
      [overdue],
      { tasks: [overdue, far], memories },
      { source: "on_demand" },
    );
    expect(reply).toBe("Ringkasan tugas");
  });

  it("DM briefing with empty Filter B returns emptyBriefingReply without Gemini", async () => {
    const far = { id: "f1", task: "Far B", status: "To Do", priority: "Medium", due: "2026-12-01" } as TaskRecord;
    const d = deps({
      listActiveTasks: vi.fn(async () => [far]),
      generateTaskBriefing: vi.fn(async () => "should not run"),
    });
    const reply = await handleUserMessage(env, 123, config, { text: "briefing" }, d);
    expect(reply).toBe(emptyBriefingReply());
    expect(d.generateChatReply).not.toHaveBeenCalled();
    expect(d.generateTaskBriefing).not.toHaveBeenCalled();
  });

  it("group briefing does not short-circuit to generateTaskBriefing", async () => {
    const d = deps({
      generateChatReply: vi.fn(async () => ({ type: "text", text: "Hai di grup" })) as any,
      generateTaskBriefing: vi.fn(async () => "should not run"),
    });
    const reply = await handleUserMessage(env, "wa-group:120@g.us", config, {
      text: "briefing",
      chatContext: "group",
    }, d);
    expect(d.generateTaskBriefing).not.toHaveBeenCalled();
    expect(d.generateChatReply).toHaveBeenCalled();
    expect(reply).toBe("Hai di grup");
  });

  describe("Projects Link", () => {
    const projectsConfig = {
      notionProjectsDataSourceId: "projects-ds",
    } as AppConfig;

    const sampleProjects = [
      { id: "proj-ikn", name: "Persiapan IKN" },
      { id: "proj-port", name: "Portfolio" },
      { id: "proj-alpha", name: "Alpha" },
      { id: "proj-alpine", name: "Alpine" },
    ];

    it("create_notion_task with matching project passes projectId to createTask", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Laundry", priority: "Medium", project: "Persiapan IKN" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      await handleUserMessage(env, 123, projectsConfig, { text: "buat tugas laundry di IKN" }, d);
      expect(d.createTask).toHaveBeenCalledWith(projectsConfig, expect.objectContaining({
        task: "Laundry",
        projectId: "proj-ikn",
      }));
    });

    it("create_notion_task with unknown project does not create and asks clarify", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Laundry", priority: "Medium", project: "Finance" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(env, 123, projectsConfig, { text: "tugas finance" }, d);
      expect(d.createTask).not.toHaveBeenCalled();
      expect(reply).toMatch(/sebut project yang mana, atau bilang tanpa project/i);
      expect(reply).toContain("Persiapan IKN");
    });

    it("rejects unknown project mentioned in user text even if tool omits project arg", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Beli powerbank", priority: "Medium" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "buat tugas beli powerbank untuk project Liburan Mars" },
        d,
      );
      expect(d.createTask).not.toHaveBeenCalled();
      expect(reply).toMatch(/Project tidak cocok/i);
    });

    it("create_notion_task with ambiguous project does not create", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Stuff", priority: "Low", project: "Alp" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(env, 123, projectsConfig, { text: "tugas alp" }, d);
      expect(d.createTask).not.toHaveBeenCalled();
      expect(reply).toContain("Alpha");
      expect(reply).toContain("Alpine");
    });

    it("projects disabled ignores args.project and creates without projectId", async () => {
      const disabledConfig = { notionProjectsDataSourceId: null } as AppConfig;
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Laundry", priority: "Medium", project: "Persiapan IKN" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      await handleUserMessage(env, 123, disabledConfig, { text: "buat laundry IKN" }, d);
      expect(d.listProjects).not.toHaveBeenCalled();
      expect(d.createTask).toHaveBeenCalledWith(disabledConfig, {
        task: "Laundry",
        priority: "Medium",
      });
      expect(d.createTask).toHaveBeenCalledWith(
        disabledConfig,
        expect.not.objectContaining({ projectId: expect.anything() }),
      );
    });

    it("read_notion_tasks includes ⟨Project⟩ when projectName present", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{ name: "read_notion_tasks", args: {} }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
        listActiveTasks: vi.fn(async () => [
          {
            id: "1",
            task: "Laundry",
            status: "To Do",
            priority: "High",
            due: "2026-09-20",
            projectName: "Persiapan IKN",
          },
        ]) as any,
      });
      const reply = await handleUserMessage(env, 123, projectsConfig, { text: "list tugas" }, d);
      expect(reply).toContain("1. [High] Laundry ⟨Persiapan IKN⟩ — 2026-09-20");
    });

    it("passes projects into generateChatReply when projects data source configured", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn(async (_c, _m, ctx) => {
          expect(ctx.projects).toEqual(sampleProjects);
          expect(ctx.projectsEnabled).toBe(true);
          return { type: "text", text: "Hai" };
        }) as any,
      });
      await handleUserMessage(env, 123, projectsConfig, { text: "Halo" }, d);
      expect(d.listProjects).toHaveBeenCalledWith(projectsConfig);
      expect(d.generateChatReply).toHaveBeenCalled();
    });

    it("create_notion_task unknown project includes hint to buat project", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_task",
              args: { title: "Laundry", priority: "Medium", project: "Finance" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(env, 123, projectsConfig, { text: "tugas finance" }, d);
      expect(d.createTask).not.toHaveBeenCalled();
      expect(reply).toMatch(/Mau kubuatkan project itu dulu\? Bilang "buat project/i);
    });
  });

  describe("Projects CRUD", () => {
    const projectsConfig = {
      notionProjectsDataSourceId: "projects-ds",
    } as AppConfig;

    const sampleProjects = [
      { id: "proj-ikn", name: "Persiapan IKN" },
      { id: "proj-port", name: "Portfolio" },
    ];

    it("create_notion_project creates when name is unique", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        createProject: vi.fn(async () => "proj-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: { name: "Liburan Mars", area: "Belajar", deadline: "2026-12-01" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "buat project Liburan Mars" },
        d,
      );
      expect(d.createProject).toHaveBeenCalledWith(projectsConfig, {
        name: "Liburan Mars",
        area: "Belajar",
        deadline: "2026-12-01",
      });
      expect(reply).toMatch(/Liburan Mars/i);
      expect(reply).toMatch(/sudah|berhasil|dibuat/i);
    });

    it("create_notion_project rejects exact duplicate name", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        createProject: vi.fn(async () => "proj-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: { name: "portfolio" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "buat project portfolio" },
        d,
      );
      expect(d.createProject).not.toHaveBeenCalled();
      expect(reply).toMatch(/sudah ada/i);
      expect(reply).toMatch(/Portfolio/i);
    });

    it("create_notion_project refuses when listProjects throws (no fail-open)", async () => {
      const d = deps({
        listProjects: vi.fn(async () => {
          throw new Error("Notion down");
        }),
        createProject: vi.fn(async () => "proj-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: { name: "Liburan Mars" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "buat project Liburan Mars" },
        d,
      );
      expect(d.createProject).not.toHaveBeenCalled();
      expect(reply).toMatch(/gagal cek|coba lagi/i);
    });

    it("create_notion_project refreshes cache so same-turn update can match new project", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        createProject: vi.fn(async () => "proj-mars"),
        updateProject: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [
              {
                name: "create_notion_project",
                args: { name: "Liburan Mars" },
              },
              {
                name: "update_notion_project",
                args: { project: "Liburan Mars", area: "Belajar" },
              },
            ],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "buat project Liburan Mars lalu set area" },
        d,
      );
      expect(d.createProject).toHaveBeenCalledTimes(1);
      expect(d.updateProject).toHaveBeenCalledWith(projectsConfig, "proj-mars", {
        area: "Belajar",
      });
      expect(reply).toMatch(/sudah dibuat/i);
      expect(reply).toMatch(/berhasil|diperbarui|diubah/i);
    });

    it("create_notion_project soft-disables when projects not configured", async () => {
      const disabledConfig = { notionProjectsDataSourceId: null } as AppConfig;
      const d = deps({
        createProject: vi.fn(async () => "proj-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: { name: "Liburan Mars" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        disabledConfig,
        { text: "buat project Liburan Mars" },
        d,
      );
      expect(d.createProject).not.toHaveBeenCalled();
      expect(d.listProjects).not.toHaveBeenCalled();
      expect(reply).toContain("Projects belum dikonfigurasi.");
    });

    it("passes projectsEnabled false when projects data source unset", async () => {
      const disabledConfig = { notionProjectsDataSourceId: null } as AppConfig;
      const d = deps({
        generateChatReply: vi.fn(async (_c, _m, ctx) => {
          expect(ctx.projectsEnabled).toBe(false);
          return { type: "text", text: "Hai" };
        }) as any,
      });
      await handleUserMessage(env, 123, disabledConfig, { text: "Halo" }, d);
      expect(d.generateChatReply).toHaveBeenCalled();
    });

    it("update_notion_project patches matched project", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        updateProject: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_project",
              args: {
                project: "Persiapan IKN",
                new_name: "Persiapan IKN 2026",
                area: "Kerja",
                deadline: "2026-11-01",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "ubah nama project Persiapan IKN" },
        d,
      );
      expect(d.updateProject).toHaveBeenCalledWith(projectsConfig, "proj-ikn", {
        name: "Persiapan IKN 2026",
        area: "Kerja",
        deadline: "2026-11-01",
      });
      expect(reply).toMatch(/berhasil|diperbarui|diubah/i);
    });

    it("update_notion_project clarifies when project unknown", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        updateProject: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_project",
              args: { project: "Finance", new_name: "Finance 2" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "ubah project Finance" },
        d,
      );
      expect(d.updateProject).not.toHaveBeenCalled();
      expect(reply).toMatch(/tidak cocok|tidak ketemu|tidak ada/i);
    });

    it("delete_notion_project saves pending delete and asks confirm", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "delete_notion_project",
              args: { project: "Portfolio" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "hapus project Portfolio" },
        d,
      );
      expect(d.archiveProject).not.toHaveBeenCalled();
      expect(d.savePendingDelete).toHaveBeenCalledWith(
        env,
        123,
        expect.objectContaining({
          kind: "project",
          ids: ["proj-port"],
          summary: "Portfolio",
        }),
      );
      expect(reply).toContain('Aldo, yakin hapus project Portfolio? Task di dalamnya tidak ikut terhapus. Balas "ya" atau "jangan".');
    });

    it("confirm ya after delete_notion_project archives via archiveProject", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        getPendingDelete: vi.fn(async () => ({
          kind: "project" as const,
          ids: ["proj-port"],
          summary: "Portfolio",
          createdAt: Date.now(),
        })),
      });
      const reply = await handleUserMessage(env, 123, projectsConfig, { text: "ya" }, d);
      expect(d.archiveProject).toHaveBeenCalledWith(projectsConfig, "proj-port");
      expect(d.archiveTask).not.toHaveBeenCalled();
      expect(reply).toMatch(/berhasil menghapus 1 project/i);
    });

    it("confirm ya for pending project delete clears without archive when projects not configured", async () => {
      const disabledConfig = { notionProjectsDataSourceId: null } as AppConfig;
      const d = deps({
        getPendingDelete: vi.fn(async () => ({
          kind: "project" as const,
          ids: ["proj-port"],
          summary: "Portfolio",
          createdAt: Date.now(),
        })),
      });
      const reply = await handleUserMessage(env, 123, disabledConfig, { text: "ya" }, d);
      expect(d.archiveProject).not.toHaveBeenCalled();
      expect(d.clearPendingDelete).toHaveBeenCalledWith(env, 123);
      expect(d.generateChatReply).not.toHaveBeenCalled();
      expect(reply).toContain("Projects belum dikonfigurasi.");
    });

    it("update_notion_project matches by project id", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        updateProject: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_project",
              args: { project: "proj-ikn", area: "Kerja" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsConfig,
        { text: "ubah area project proj-ikn" },
        d,
      );
      expect(d.updateProject).toHaveBeenCalledWith(projectsConfig, "proj-ikn", {
        area: "Kerja",
      });
      expect(reply).toMatch(/berhasil|diperbarui|diubah/i);
    });
  });

  describe("Goals CRUD", () => {
    const goalsConfig = {
      notionGoalsDataSourceId: "goals-ds",
      notionProjectsDataSourceId: "projects-ds",
    } as AppConfig;

    const sampleGoals = [
      { id: "goal-iot", name: "Menguasai Embedded + IoT" },
      { id: "goal-inc", name: "Dapat income pertama dari skill" },
    ];

    const sampleProjects = [
      { id: "proj-ikn", name: "Persiapan IKN" },
      { id: "proj-port", name: "Portfolio" },
    ];

    it("create_notion_goal creates when name is unique", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        createGoal: vi.fn(async () => "goal-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_goal",
              args: {
                name: "Belajar Rust",
                area: "Belajar",
                metric: "1 project",
                progress: 0,
                status: "Not started",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "buat goal Belajar Rust" },
        d,
      );
      expect(d.createGoal).toHaveBeenCalledWith(goalsConfig, {
        name: "Belajar Rust",
        area: "Belajar",
        metric: "1 project",
        progress: 0,
        status: "Not started",
      });
      expect(reply).toMatch(/Belajar Rust/i);
      expect(reply).toMatch(/sudah|berhasil|dibuat/i);
    });

    it("create_notion_goal rejects exact duplicate name", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        createGoal: vi.fn(async () => "goal-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_goal",
              args: { name: "menguasai embedded + iot" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "buat goal menguasai embedded + iot" },
        d,
      );
      expect(d.createGoal).not.toHaveBeenCalled();
      expect(reply).toMatch(/sudah ada/i);
      expect(reply).toMatch(/Menguasai Embedded \+ IoT/i);
    });

    it("create_notion_goal soft-disables when goals not configured", async () => {
      const disabledConfig = {
        notionGoalsDataSourceId: null,
        notionProjectsDataSourceId: "projects-ds",
      } as AppConfig;
      const d = deps({
        createGoal: vi.fn(async () => "goal-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_goal",
              args: { name: "Belajar Rust" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        disabledConfig,
        { text: "buat goal Belajar Rust" },
        d,
      );
      expect(d.createGoal).not.toHaveBeenCalled();
      expect(d.listGoals).not.toHaveBeenCalled();
      expect(reply).toContain("Goals belum dikonfigurasi.");
    });

    it("passes goalsEnabled and goals into generateChatReply", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        generateChatReply: vi.fn(async (_c, _m, ctx) => {
          expect(ctx.goalsEnabled).toBe(true);
          expect(ctx.goals).toEqual(sampleGoals);
          expect(ctx.projectsEnabled).toBe(true);
          return { type: "text", text: "Hai" };
        }) as any,
      });
      await handleUserMessage(env, 123, goalsConfig, { text: "Halo" }, d);
      expect(d.listGoals).toHaveBeenCalledWith(goalsConfig);
    });

    it("passes goalsEnabled false when goals data source unset", async () => {
      const disabledConfig = {
        notionGoalsDataSourceId: null,
        notionProjectsDataSourceId: "projects-ds",
      } as AppConfig;
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn(async (_c, _m, ctx) => {
          expect(ctx.goalsEnabled).toBe(false);
          expect(ctx.projectsEnabled).toBe(true);
          return { type: "text", text: "Hai" };
        }) as any,
      });
      await handleUserMessage(env, 123, disabledConfig, { text: "Halo" }, d);
      expect(d.listGoals).not.toHaveBeenCalled();
    });

    it("update_notion_goal patches matched goal", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        updateGoal: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_goal",
              args: {
                goal: "Menguasai Embedded + IoT",
                progress: 10,
                status: "In progress",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "ubah progress goal Menguasai Embedded + IoT jadi 10" },
        d,
      );
      expect(d.updateGoal).toHaveBeenCalledWith(goalsConfig, "goal-iot", {
        progress: 10,
        status: "In progress",
      });
      expect(reply).toMatch(/berhasil|diperbarui|diubah/i);
    });

    it("update_notion_goal clarifies when goal unknown", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        updateGoal: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_goal",
              args: { goal: "Finance", progress: 5 },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "ubah goal Finance" },
        d,
      );
      expect(d.updateGoal).not.toHaveBeenCalled();
      expect(reply).toMatch(/tidak cocok|tidak ketemu|tidak ada/i);
    });

    it("delete_notion_goal saves pending delete and asks confirm", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "delete_notion_goal",
              args: { goal: "Dapat income pertama dari skill" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "hapus goal Dapat income pertama dari skill" },
        d,
      );
      expect(d.archiveGoal).not.toHaveBeenCalled();
      expect(d.savePendingDelete).toHaveBeenCalledWith(
        env,
        123,
        expect.objectContaining({
          kind: "goal",
          ids: ["goal-inc"],
          summary: "Dapat income pertama dari skill",
        }),
      );
      expect(reply).toContain(
        'Aldo, yakin hapus goal Dapat income pertama dari skill? Project di bawahnya tidak ikut terhapus. Balas "ya" atau "jangan".',
      );
    });

    it("confirm ya after delete_notion_goal archives via archiveGoal", async () => {
      const d = deps({
        listGoals: vi.fn(async () => sampleGoals),
        getPendingDelete: vi.fn(async () => ({
          kind: "goal" as const,
          ids: ["goal-inc"],
          summary: "Dapat income pertama dari skill",
          createdAt: Date.now(),
        })),
      });
      const reply = await handleUserMessage(env, 123, goalsConfig, { text: "ya" }, d);
      expect(d.archiveGoal).toHaveBeenCalledWith(goalsConfig, "goal-inc");
      expect(d.archiveProject).not.toHaveBeenCalled();
      expect(reply).toMatch(/berhasil menghapus 1 goal/i);
    });

    it("create_notion_project with goal sets goalId", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        listGoals: vi.fn(async () => sampleGoals),
        createProject: vi.fn(async () => "proj-esp"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: {
                name: "Portfolio ESP32",
                goal: "Menguasai Embedded + IoT",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "buat project Portfolio ESP32 untuk goal Menguasai Embedded + IoT" },
        d,
      );
      expect(d.createProject).toHaveBeenCalledWith(goalsConfig, {
        name: "Portfolio ESP32",
        goalId: "goal-iot",
      });
      expect(reply).toMatch(/Portfolio ESP32/i);
      expect(reply).toMatch(/sudah|berhasil|dibuat/i);
    });

    it("create_notion_project with goal soft-disables when goals not configured", async () => {
      const noGoalsConfig = {
        notionGoalsDataSourceId: null,
        notionProjectsDataSourceId: "projects-ds",
      } as AppConfig;
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        createProject: vi.fn(async () => "proj-esp"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: {
                name: "Portfolio ESP32",
                goal: "Menguasai Embedded + IoT",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        noGoalsConfig,
        { text: "buat project Portfolio ESP32 untuk goal X" },
        d,
      );
      expect(d.createProject).not.toHaveBeenCalled();
      expect(reply).toContain("Goals belum dikonfigurasi.");
    });

    it("update_notion_project with goal sets goalId", async () => {
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        listGoals: vi.fn(async () => sampleGoals),
        updateProject: vi.fn(async () => undefined),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "update_notion_project",
              args: {
                project: "Portfolio",
                goal: "Menguasai Embedded + IoT",
              },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        goalsConfig,
        { text: "tautkan project Portfolio ke goal Menguasai Embedded + IoT" },
        d,
      );
      expect(d.updateProject).toHaveBeenCalledWith(goalsConfig, "proj-port", {
        goalId: "goal-iot",
      });
      expect(reply).toMatch(/berhasil|diperbarui|diubah/i);
    });

    it("projects CRUD still works without goals configured", async () => {
      const projectsOnlyConfig = {
        notionGoalsDataSourceId: null,
        notionProjectsDataSourceId: "projects-ds",
      } as AppConfig;
      const d = deps({
        listProjects: vi.fn(async () => sampleProjects),
        createProject: vi.fn(async () => "proj-new"),
        generateChatReply: vi.fn()
          .mockResolvedValueOnce({
            type: "function_calls",
            calls: [{
              name: "create_notion_project",
              args: { name: "Liburan Mars", area: "Belajar" },
            }],
          })
          .mockResolvedValue({ type: "text", text: "ok" }) as any,
      });
      const reply = await handleUserMessage(
        env,
        123,
        projectsOnlyConfig,
        { text: "buat project Liburan Mars" },
        d,
      );
      expect(d.createProject).toHaveBeenCalledWith(projectsOnlyConfig, {
        name: "Liburan Mars",
        area: "Belajar",
      });
      expect(d.listGoals).not.toHaveBeenCalled();
      expect(reply).toMatch(/Liburan Mars/i);
      expect(reply).toMatch(/sudah|berhasil|dibuat/i);
    });

    it("listGoals soft-fails like listProjects (continues without goals)", async () => {
      const d = deps({
        listGoals: vi.fn(async () => {
          throw new Error("Notion goals down");
        }),
        listProjects: vi.fn(async () => sampleProjects),
        generateChatReply: vi.fn(async (_c, _m, ctx) => {
          expect(ctx.goalsEnabled).toBe(true);
          expect(ctx.goals).toEqual([]);
          return { type: "text", text: "Hai" };
        }) as any,
      });
      const reply = await handleUserMessage(env, 123, goalsConfig, { text: "Halo" }, d);
      expect(reply).toBe("Hai");
      expect(d.listGoals).toHaveBeenCalled();
    });
  });
});
