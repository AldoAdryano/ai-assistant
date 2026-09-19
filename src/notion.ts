import type { AppConfig, MemoryCategory, MemoryRecord, NoteType, Priority, RoutineRecord, TaskRecord } from "./types";
import { normalizeNotionDue, stripDeadlineLeakFromTitle, nowWib, getJakartaDateParts } from "./date";

export class NotionRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionRejectionError";
  }
}

export class NotionUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionUnknownError";
  }
}

async function notionRequest<T>(config: AppConfig, path: string, init: RequestInit, fetchImpl: typeof fetch): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.notion.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.notionApiKey}`,
        "Notion-Version": config.notionVersion,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    throw new NotionUnknownError(`Network error: ${error instanceof Error ? error.message : "unknown"}`);
  }

  if (!response.ok) {
    let errCode = "unknown_code";
    let errMsg = "unknown error";
    try {
      const errJson = await response.json() as any;
      if (typeof errJson?.code === "string") errCode = errJson.code;
      if (typeof errJson?.message === "string") errMsg = errJson.message;
    } catch {
      errMsg = "failed to parse json";
    }
    let safeMsg = errMsg;
    safeMsg = safeMsg.replace(/secret_[a-zA-Z0-9_-]+/gi, "<REDACTED>");
    safeMsg = safeMsg.replace(/ntn_[a-zA-Z0-9_-]+/gi, "<REDACTED>");
    safeMsg = safeMsg.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, "<UUID>");
    safeMsg = safeMsg.replace(/\d+:[A-Za-z0-9_-]{30,}/g, "<TG_TOKEN>");
    if (safeMsg.length > 300) safeMsg = safeMsg.slice(0, 300) + "...";
    console.error(`Notion API error: HTTP ${response.status} code=${errCode} message=${safeMsg}`);

    const errorMessage = `Notion request failed with HTTP ${response.status}: ${safeMsg}`;
    if (response.status === 400 || response.status === 403 || response.status === 404) {
      throw new NotionRejectionError(errorMessage);
    }
    throw new NotionUnknownError(errorMessage);
  }
  return await response.json() as T;
}

function titleText(property: any): string {
  return property?.title?.map((item: any) => item?.plain_text ?? "").join("").trim() ?? "";
}
function richText(property: any): string {
  return property?.rich_text?.map((item: any) => item?.plain_text ?? "").join("").trim() ?? "";
}
function textItems(text: string): Array<{ type: "text"; text: { content: string } }> {
  const items: Array<{ type: "text"; text: { content: string } }> = [];
  for (let start = 0; start < text.length; start += 2000) items.push({ type: "text", text: { content: text.slice(start, start + 2000) } });
  return items.length > 0 ? items : [{ type: "text", text: { content: "" } }];
}

export async function createNote(config: AppConfig, note: { text: string; noteType: NoteType }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const result = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.notionInboxDataSourceId },
      properties: {
        Name: { title: [{ type: "text", text: { content: note.text.slice(0, 200) } }] },
        Type: { select: { name: note.noteType } },
        Content: { rich_text: textItems(note.text) },
        Source: { select: { name: "Telegram" } },
      },
    }),
  }, fetchImpl);
  return result.id;
}

export async function createTask(config: AppConfig, task: { task: string; priority: Priority; due_date?: string; due_time?: string }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const cleanTitle = stripDeadlineLeakFromTitle(task.task);
  const properties: Record<string, unknown> = {
    Task: { title: textItems(cleanTitle) }, Status: { select: { name: "To Do" } }, Priority: { select: { name: task.priority } }, Source: { select: { name: "Telegram" } },
  };
  const combinedDue = task.due_time && task.due_date ? `${task.due_date}T${task.due_time}:00+07:00` : task.due_date;
  const normDue = normalizeNotionDue(combinedDue);
  if (normDue) properties.Due = { date: { start: normDue } };
  const result = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: config.notionTasksDataSourceId }, properties }),
  }, fetchImpl);
  return result.id;
}

export async function updateTask(config: AppConfig, pageId: string, updateData: { due_date?: string; due_time?: string; priority?: Priority; status?: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (updateData.priority) properties.Priority = { select: { name: updateData.priority } };
  if (updateData.status) properties.Status = { select: { name: updateData.status } };
  
  const combinedDue = updateData.due_time && updateData.due_date ? `${updateData.due_date}T${updateData.due_time}:00+07:00` : updateData.due_date;
  if (combinedDue) {
    const normDue = normalizeNotionDue(combinedDue);
    if (normDue) properties.Due = { date: { start: normDue } };
  }

  await notionRequest(config, `/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  }, fetchImpl);
}

export async function archiveTask(config: AppConfig, pageId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await notionRequest(config, `/blocks/${pageId}`, {
    method: "DELETE",
  }, fetchImpl);
}

export async function listActiveTasks(config: AppConfig, statusFilter?: string, fetchImpl: typeof fetch = fetch): Promise<TaskRecord[]> {
  const filterParams = statusFilter
    ? { property: "Status", select: { equals: statusFilter } }
    : { property: "Status", select: { does_not_equal: "Done" } };
  
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionTasksDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ filter: filterParams, page_size: 50 }),
  }, fetchImpl);
  
  const rank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return result.results.map((page): TaskRecord | null => {
    const status = page.properties?.Status?.select?.name;
    const priority = page.properties?.Priority?.select?.name;
    if (statusFilter && status !== statusFilter) return null;
    if (!statusFilter && status !== "To Do" && status !== "Doing") return null;
    if (priority !== "Low" && priority !== "Medium" && priority !== "High") return null;
    const due = page.properties?.Due?.date?.start;
    return { id: page.id, task: titleText(page.properties?.Task), status, priority, ...(typeof due === "string" ? { due } : {}) };
  }).filter((task): task is TaskRecord => task !== null && task.task !== "").sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export async function getUpcomingTasks(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<TaskRecord[]> {
  return listActiveTasks(config, undefined, fetchImpl);
}

export async function getAllTasks(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<TaskRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionTasksDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ page_size: 100 }),
  }, fetchImpl);
  
  const rank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return result.results.map((page): TaskRecord | null => {
    const status = page.properties?.Status?.select?.name;
    const priority = page.properties?.Priority?.select?.name;
    if (priority !== "Low" && priority !== "Medium" && priority !== "High") return null;
    const due = page.properties?.Due?.date?.start;
    return { id: page.id, task: titleText(page.properties?.Task), status, priority, ...(typeof due === "string" ? { due } : {}) };
  }).filter((task): task is TaskRecord => task !== null && task.task !== "").sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export async function getAllNotes(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<Array<{ id: string; title: string }>> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionInboxDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ page_size: 100 }),
  }, fetchImpl);
  
  return result.results.map((page): { id: string; title: string } | null => {
    const title = titleText(page.properties?.Name);
    return title ? { id: page.id, title } : null;
  }).filter((note): note is { id: string; title: string } => note !== null);
}

function mapMemory(page: any): MemoryRecord | null {
  const key = titleText(page.properties?.Key);
  const value = richText(page.properties?.Value);
  const category = page.properties?.Category?.select?.name;
  if (!key || !value || (category !== "Profile" && category !== "Preference" && category !== "Project" && category !== "Other")) return null;
  return { id: page.id, key, value, category };
}

export async function upsertMemory(config: AppConfig, memory: { key: string; value: string; category: MemoryCategory }, fetchImpl: typeof fetch = fetch): Promise<string> {
  const query = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionMemoryDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ filter: { property: "Key", title: { equals: memory.key } }, page_size: 1 }),
  }, fetchImpl);
  const properties = { Value: { rich_text: textItems(memory.value) }, Category: { select: { name: memory.category } } };
  const existingId = query.results[0]?.id;
  if (typeof existingId === "string") {
    await notionRequest(config, `/pages/${existingId}`, { method: "PATCH", body: JSON.stringify({ properties }) }, fetchImpl);
    return existingId;
  }
  const created = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: config.notionMemoryDataSourceId }, properties: { Key: { title: textItems(memory.key) }, ...properties } }),
  }, fetchImpl);
  return created.id;
}

export async function recallMemory(config: AppConfig, queryText: string, fetchImpl: typeof fetch = fetch): Promise<MemoryRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionMemoryDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ filter: { or: [
      { property: "Key", title: { contains: queryText } }, { property: "Value", rich_text: { contains: queryText } },
    ] }, page_size: 10 }),
  }, fetchImpl);
  return result.results.map(mapMemory).filter((memory): memory is MemoryRecord => memory !== null);
}

export async function listMemoryContext(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<MemoryRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionMemoryDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ sorts: [{ timestamp: "last_edited_time", direction: "descending" }], page_size: 10 }),
  }, fetchImpl);
  return result.results.map(mapMemory).filter((memory): memory is MemoryRecord => memory !== null);
}

export async function getAllMemory(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<MemoryRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionMemoryDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ page_size: 100 }),
  }, fetchImpl);
  return result.results.map(mapMemory).filter((memory): memory is MemoryRecord => memory !== null);
}

export async function getActiveRoutines(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<RoutineRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionRoutineDbId}/query`, {
    method: "POST", body: JSON.stringify({ page_size: 100 }),
  }, fetchImpl);
  
  return result.results.map(page => {
    const name = page.properties.Name?.title?.[0]?.plain_text;
    let time = page.properties.Waktu?.rich_text?.[0]?.plain_text;
    const dateStart = page.properties.Waktu?.date?.start;
    if (dateStart) {
      // Extract HH:mm from ISO string
      const match = dateStart.match(/T(\d{2}:\d{2})/);
      if (match) time = match[1];
    }
    if (!name || !time) return null;
    return { id: page.id, name, time };
  }).filter((routine): routine is RoutineRecord => routine !== null);
}

export async function addRoutine(config: AppConfig, name: string, timeText: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const parts = getJakartaDateParts(nowWib());
  const todayWibDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  
  const properties: Record<string, unknown> = {
    Name: { title: textItems(name) },
    Waktu: { date: { start: `${todayWibDate}T${timeText}:00+07:00` } }
  };
  const result = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { type: "data_source_id", data_source_id: config.notionRoutineDbId }, properties }),
  }, fetchImpl);
  return result.id;
}
