import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runScheduled } from "../src/index";
import type { Env } from "../src/types";

describe("Scheduled Alarm Reader (Task 53.1)", () => {
  const env: Env = {
    DEDUP_KV: { put: vi.fn(), list: vi.fn(), get: vi.fn(), delete: vi.fn() } as any,
    GEMINI_API_KEY: "test",
    NOTION_API_KEY: "test",
    NOTION_TASKS_DATA_SOURCE_ID: "task-ds",
    NOTION_INBOX_DATA_SOURCE_ID: "inbox-ds",
    NOTION_MEMORY_DATA_SOURCE_ID: "mem-ds",
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_WEBHOOK_SECRET: "secret",
    ALLOWED_TELEGRAM_USER_ID: "123",
    GEMINI_MODEL: "gemini-test",
    NOTION_VERSION: "2022-06-28",
    WHATSAPP_API_SECRET: "test_secret",
    ALLOWED_WHATSAPP_NUMBER: "62812",
  };

  const mockDeps = {
    handleUserMessage: vi.fn(),
    sendTelegramText: vi.fn(),
    downloadTelegramPhoto: vi.fn(),
    getUpcomingTasks: vi.fn(),
    getActiveRoutines: vi.fn(),
    listMemoryContext: vi.fn(),
    generateProactiveAlarm: vi.fn(),
    generateRoutineAlarm: vi.fn(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockDeps.listMemoryContext.mockResolvedValue([]);
    mockDeps.getActiveRoutines.mockResolvedValue([]);
    mockDeps.generateProactiveAlarm.mockResolvedValue("Alarm!");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Condition A: date-only at 16:50 WIB → TIDAK masuk tasksToRemind", async () => {
    // 16:50 WIB = 09:50 UTC
    vi.setSystemTime(new Date("2026-09-02T09:50:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas", status: "To Do", priority: "High", due: "2026-09-02" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).not.toHaveBeenCalled();
  });

  it("date-only at 07:00 WIB → remind", async () => {
    // 07:00 WIB = 00:00 UTC
    vi.setSystemTime(new Date("2026-09-02T00:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas harian", status: "To Do", priority: "High", due: "2026-09-02" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledTimes(1);
  });

  it("date-only at 18:00 WIB → remind", async () => {
    // 18:00 WIB = 11:00 UTC
    vi.setSystemTime(new Date("2026-09-02T11:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas harian", status: "To Do", priority: "High", due: "2026-09-02" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledTimes(1);
  });

  it("date-only at 12:00 WIB → TIDAK remind (slot siang dihapus)", async () => {
    // 12:00 WIB = 05:00 UTC
    vi.setSystemTime(new Date("2026-09-02T05:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas harian", status: "To Do", priority: "High", due: "2026-09-02" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).not.toHaveBeenCalled();
  });

  it("Condition B: datetime 60 menit ke depan → MASUK tasksToRemind", async () => {
    // 10:00 UTC = 17:00 WIB
    const now = new Date("2026-09-02T10:00:00Z");
    vi.setSystemTime(now);

    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas", status: "To Do", priority: "High", due: "2026-09-02T11:00:00Z" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({ due: "2026-09-02T11:00:00Z" })
    ], { tasks: expect.any(Array), memories: expect.any(Array) });
  });

  it("urgent datetime: cron tiap 10 menit boleh kirim ulang dalam jendela 60 menit", async () => {
    env.DEDUP_KV = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(),
    } as any;

    vi.setSystemTime(new Date("2026-09-02T10:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "task-laprak", task: "Bikin laprak sistem kendali", status: "To Do", priority: "High", due: "2026-09-02T11:00:00Z" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    vi.setSystemTime(new Date("2026-09-02T10:10:00Z"));
    await runScheduled({} as any, env, {} as any, mockDeps as any);

    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledTimes(2);
  });

  it("Condition B: datetime 90 menit ke depan di jam non-slot → TIDAK masuk", async () => {
    // 10:00 UTC = 17:00 WIB (bukan 07/18)
    vi.setSystemTime(new Date("2026-09-02T10:00:00Z"));

    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas", status: "To Do", priority: "High", due: "2026-09-02T11:30:00Z" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).not.toHaveBeenCalled();
  });

  it("datetime > 60 menit di 07:00 WIB → remind rutin", async () => {
    // 07:00 WIB = 00:00 UTC; due 5 jam lagi
    vi.setSystemTime(new Date("2026-09-02T00:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas sore", status: "To Do", priority: "High", due: "2026-09-02T05:00:00Z" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledTimes(1);
  });

  it("datetime ≤ 60 menit di jam non-slot → tetap remind urgent", async () => {
    // 15:00 WIB = 08:00 UTC; due 45 menit lagi
    vi.setSystemTime(new Date("2026-09-02T08:00:00Z"));
    mockDeps.getUpcomingTasks.mockResolvedValue([
      { id: "1", task: "Tugas mepet", status: "To Do", priority: "High", due: "2026-09-02T08:45:00Z" }
    ]);

    await runScheduled({} as any, env, {} as any, mockDeps as any);
    expect(mockDeps.generateProactiveAlarm).toHaveBeenCalledTimes(1);
  });
});
