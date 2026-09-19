import { expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types";
import { NotionRejectionError, NotionUnknownError, createNote, createTask, listActiveTasks, listMemoryContext, recallMemory, upsertMemory, updateTask, archiveTask } from "../src/notion";

const config: AppConfig = {
  geminiApiKey: "gemini-key", geminiModel: "gemini-3.5-flash-lite",
  notionApiKey: "notion-key", notionVersion: "2026-03-11", notionInboxDataSourceId: "inbox-ds", notionTasksDataSourceId: "tasks-ds", notionMemoryDataSourceId: "memory-ds",
  telegramBotToken: "123456:test", telegramWebhookSecret: "secret_123", allowedTelegramUserId: "111111111", notionRoutineDbId: "r-db", whatsappApiSecret: "w-sec", allowedWhatsappNumber: "w-num",
};

it("creates an Inbox page with a data_source_id parent", async () => {
  let captured: { url?: string; init?: RequestInit } = {};
  const fakeFetch: typeof fetch = async (input, init) => { captured = { url: String(input), ...(init ? { init } : {}) }; return new Response(JSON.stringify({ id: "page-note" }), { status: 200 }); };
  await createNote(config, { text: "dark pattern", noteType: "Idea" }, fakeFetch);
  expect(captured.url).toBe("https://api.notion.com/v1/pages");
  const body = JSON.parse(String(captured.init?.body));
  expect(body.parent).toEqual({ type: "data_source_id", data_source_id: "inbox-ds" });
  expect(body.properties.Name.title[0].text.content).toBe("dark pattern");
  expect(body.properties.Type.select.name).toBe("Idea");
  expect(body.properties.Source).toEqual({ select: { name: "Telegram" } });
});

it("chunks long Notion rich text values at the API limit", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-note-long" }), { status: 200 }); };
  await createNote(config, { text: "x".repeat(2200), noteType: "Note" }, fakeFetch);
  expect(body.properties.Content.rich_text).toHaveLength(2);
  expect(body.properties.Content.rich_text[0].text.content).toHaveLength(2000);
  expect(body.properties.Content.rich_text[1].text.content).toHaveLength(200);
});

it("creates a task with defaults and optional due date", async () => {
  let bodyWithDue: any;
  let bodyWithoutDue: any;
  const fakeFetchDue: typeof fetch = async (_input, init) => { bodyWithDue = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task-due" }), { status: 200 }); };
  const fakeFetchNoDue: typeof fetch = async (_input, init) => { bodyWithoutDue = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task-nodue" }), { status: 200 }); };
  
  await createTask(config, { task: "revisi bab 2", priority: "High", due_date: "2026-09-03" }, fakeFetchDue);
  expect(bodyWithDue.properties.Status.select.name).toBe("To Do");
  expect(bodyWithDue.properties.Priority.select.name).toBe("High");
  expect(bodyWithDue.properties.Due.date.start).toBe("2026-09-03");
  expect(bodyWithDue.properties.Source).toEqual({ select: { name: "Telegram" } });

  await createTask(config, { task: "revisi bab 3", priority: "Medium" }, fakeFetchNoDue);
  expect(bodyWithoutDue.properties.Status.select.name).toBe("To Do");
  expect(bodyWithoutDue.properties.Priority.select.name).toBe("Medium");
  expect(bodyWithoutDue.properties.Due).toBeUndefined();
});

it("creates a task with Notes rich_text from notes field", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-task-notes" }), { status: 200 });
  };
  await createTask(config, {
    task: "Simurelay",
    priority: "High",
    notes: "instal di hp\nbuat instalasi listrik",
  }, fakeFetch);
  expect(body.properties.Task.title[0].text.content).toBe("Simurelay");
  expect(body.properties.Notes.rich_text[0].text.content).toContain("instal di hp");
  expect(body.properties.Due).toBeUndefined();
});

it("Task 53: creates a task with sanitized title and correctly formatted datetime", async () => {
  let bodyWithTime: any;
  const fakeFetch: typeof fetch = async (_input, init) => { bodyWithTime = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task" }), { status: 200 }); };
  
  await createTask(config, { task: "foo Konteks: Deadline jam 16:46", priority: "High", due_date: "2026-09-02", due_time: "16:46" }, fakeFetch);
  
  expect(bodyWithTime.properties.Task.title[0].text.content).toBe("foo");
  expect(bodyWithTime.properties.Due.date.start).toBe("2026-09-02T16:46:00+07:00");
  
  // Task 55: Test with dot-separated time "18.08"
  await createTask(config, { task: "bar", priority: "High", due_date: "2026-09-02", due_time: "18:08" }, fakeFetch);
  // Expect it to resolve against nowWib (which isn't frozen, so we might need to mock or just expect it to include "T" and "+07:00")
  expect(bodyWithTime.properties.Due.date.start).toContain("T");
  expect(bodyWithTime.properties.Due.date.start).toContain("+07:00");
});

it("Task 53: updates a task with sanitized title and correctly formatted datetime", async () => {
  let bodyUpdate: any;
  const fakeFetch: typeof fetch = async (_input, init) => { bodyUpdate = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ id: "page-task" }), { status: 200 }); };
  
  await updateTask(config, "task-id", { due_date: "2026-09-02", due_time: "16:46" }, fakeFetch);
  
  // It only updates what's passed, so Due should be present
  expect(bodyUpdate.properties.Due.date.start).toBe("2026-09-02T16:46:00+07:00");
});

it("lists active tasks and sorts High before Medium before Low", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ results: [
    { id: "low", properties: taskProperties("Low task", "Low", "To Do") },
    { id: "high", properties: taskProperties("High task", "High", "Doing") },
    { id: "done", properties: taskProperties("Done task", "High", "Done") },
  ] }), { status: 200 });
  const tasks = await listActiveTasks(config, undefined, fakeFetch);
  expect(tasks.map((task) => task.task)).toEqual(["High task", "Low task"]);
});

it("updates an existing memory entry instead of creating a second page", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    if (String(input).endsWith("/query")) return new Response(JSON.stringify({ results: [{ id: "memory-page", properties: {} }] }), { status: 200 });
    return new Response(JSON.stringify({ id: "memory-page" }), { status: 200 });
  };
  await upsertMemory(config, { key: "topik utama", value: "personal AI WhatsApp", category: "Project" }, fakeFetch);
  expect(calls).toContain("PATCH https://api.notion.com/v1/pages/memory-page");
});

it("recalls matching memory by key or value", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ results: [{ id: "memory-1", properties: {
    Key: { title: [{ plain_text: "topik utama" }] }, Value: { rich_text: [{ plain_text: "personal AI WhatsApp" }] }, Category: { select: { name: "Project" } },
  } }] }), { status: 200 });
  const memories = await recallMemory(config, "topik", fakeFetch);
  expect(memories[0]).toMatchObject({ key: "topik utama", value: "personal AI WhatsApp" });
});

it("keeps Memory 2.0 categories when mapping list results", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ results: [
    { id: "memory-identity", properties: memoryProperties("nama", "YouYou", "Identity") },
    { id: "memory-goal", properties: memoryProperties("target", "ship memory 2.0", "Goal") },
    { id: "memory-invalid", properties: memoryProperties("bad", "dropped", "Unknown") },
  ] }), { status: 200 });
  const memories = await listMemoryContext(config, fakeFetch);
  expect(memories).toEqual([
    { id: "memory-identity", key: "nama", value: "YouYou", category: "Identity" },
    { id: "memory-goal", key: "target", value: "ship memory 2.0", category: "Goal" },
  ]);
});

it("upserts Memory 2.0 categories", async () => {
  let patchBody: any;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/query")) return new Response(JSON.stringify({ results: [{ id: "memory-page", properties: {} }] }), { status: 200 });
    patchBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "memory-page" }), { status: 200 });
  };
  await upsertMemory(config, { key: "nama", value: "YouYou", category: "Identity" }, fakeFetch);
  expect(patchBody.properties.Category.select.name).toBe("Identity");
});

function taskProperties(task: string, priority: string, status: string) {
  return { Task: { title: [{ plain_text: task }] }, Status: { select: { name: status } }, Priority: { select: { name: priority } }, Due: { date: null } };
}

function memoryProperties(key: string, value: string, category: string) {
  return { Key: { title: [{ plain_text: key }] }, Value: { rich_text: [{ plain_text: value }] }, Category: { select: { name: category } } };
}

it("throws NotionRejectionError for 400 responses and sanitizes logs", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    object: "error", status: 400, code: "validation_error", message: "body.properties.Source is wrong, secret: secret_123"
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  
  await expect(createNote(config, { text: "fail test", noteType: "Idea" }, fakeFetch)).rejects.toThrow(NotionRejectionError);
  
  expect(spy).toHaveBeenCalled();
  const logArgs = String(spy.mock.calls[0]?.[0] ?? "");
  expect(logArgs).toContain("HTTP 400");
  expect(logArgs).toContain("validation_error");
  expect(logArgs).not.toContain("secret_123");
  spy.mockRestore();
});

it("throws NotionUnknownError for 5xx responses or network errors", async () => {
  const fakeFetch500: typeof fetch = async () => new Response("Internal Server Error", { status: 500 });
  const fakeFetchNetwork: typeof fetch = async () => { throw new TypeError("Failed to fetch"); };
  
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  
  await expect(createNote(config, { text: "fail 500", noteType: "Idea" }, fakeFetch500)).rejects.toThrow(NotionUnknownError);
  await expect(createNote(config, { text: "fail network", noteType: "Idea" }, fakeFetchNetwork)).rejects.toThrow(NotionUnknownError);
  
  spy.mockRestore();
});

it("updates a task successfully", async () => {
  let body: any;
  let method: string = "";
  let url: string = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-task" }), { status: 200 });
  };
  
  await updateTask(config, "page-task-id", { due_date: "2026-10-01", priority: "High", status: "Done" }, fakeFetch);
  
  expect(method).toBe("PATCH");
  expect(url).toContain("/pages/page-task-id");
  expect(body.properties.Due.date.start).toBe("2026-10-01");
  expect(body.properties.Priority.select.name).toBe("High");
  expect(body.properties.Status.select.name).toBe("Done");
});

it("throws NotionRejectionError for updateTask on 400", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    object: "error", status: 400, code: "validation_error", message: "invalid property"
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  
  await expect(updateTask(config, "page-id", { priority: "High" }, fakeFetch)).rejects.toThrow(NotionRejectionError);
  spy.mockRestore();
});

it("archives a task successfully", async () => {
  let body: any;
  let method: string = "";
  let url: string = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    if (init?.body) body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "page-task" }), { status: 200 });
  };
  
  await archiveTask(config, "page-task-id", fakeFetch);
  
  expect(method).toBe("DELETE");
  expect(url).toContain("/blocks/page-task-id");
});

it("throws NotionRejectionError for archiveTask on 400", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    object: "error", status: 400, code: "validation_error", message: "invalid property"
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  
  await expect(archiveTask(config, "page-id", fakeFetch)).rejects.toThrow(NotionRejectionError);
  spy.mockRestore();
});

