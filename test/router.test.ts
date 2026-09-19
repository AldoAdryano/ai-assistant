import { describe, expect, it, vi } from "vitest";
import type { AppConfig, Env, MemoryRecord, TaskRecord } from "../src/types";
import { handleUserMessage, type RouterDeps } from "../src/router";
import { NotionRejectionError } from "../src/notion";
import { GeminiApiError } from "../src/gemini";

const config = {} as AppConfig;
const env = {} as Env;

function deps(overrides: Partial<RouterDeps> = {}): RouterDeps {
  return {
    createNote: vi.fn(async () => "note-id"),
    createTask: vi.fn(async () => "task-id"),
    listActiveTasks: vi.fn(async (): Promise<TaskRecord[]> => []),
    getAllTasks: vi.fn(async (): Promise<TaskRecord[]> => []),
    getAllNotes: vi.fn(async (): Promise<Array<{ id: string; title: string }>> => []),
    upsertMemory: vi.fn(async () => "memory-id"),
    recallMemory: vi.fn(async (): Promise<MemoryRecord[]> => []),
    listMemoryContext: vi.fn(async (): Promise<MemoryRecord[]> => []),
    getAllMemory: vi.fn(async (): Promise<MemoryRecord[]> => []),
    updateTask: vi.fn(async () => undefined),
    archiveTask: vi.fn(async () => undefined),
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
    const reply = await handleUserMessage(env, 123, config, { text: "Apa tugas saya?" }, d);
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
});
