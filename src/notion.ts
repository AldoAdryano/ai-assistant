import type { AppConfig, GoalRecord, MemoryCategory, MemoryRecord, NoteType, Priority, ProjectRecord, RoutineRecord, TaskRecord } from "./types";
import { normalizeNotionDue, stripDeadlineLeakFromTitle, nowWib, getJakartaDateParts } from "./date";

export const TASK_PROJECT_PROPERTY = "Project";
export const PROJECT_GOAL_PROPERTY = "Goal";

const GOALS_PAGE_SIZE = 100;
const GOALS_MAX_ITEMS = 300;

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

const PROJECTS_PAGE_SIZE = 50;
const PROJECTS_MAX_ITEMS = 200;

function progressNumber(progress: string | number | undefined): number | undefined {
  if (typeof progress === "number") {
    return Number.isFinite(progress) ? progress : undefined;
  }
  if (typeof progress === "string") {
    const trimmed = progress.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function metricFromProperty(property: any): string | undefined {
  if (property == null) return undefined;
  if (typeof property.number === "number" && Number.isFinite(property.number)) {
    return String(property.number);
  }
  const text = richText(property);
  return text || undefined;
}

function progressFromProperty(property: any): string | number | undefined {
  if (property == null) return undefined;
  if (typeof property.number === "number" && Number.isFinite(property.number)) {
    return property.number;
  }
  const text = richText(property);
  return text || undefined;
}

function applyGoalWriteProperties(
  properties: Record<string, unknown>,
  fields: {
    name?: string;
    area?: string;
    metric?: string;
    progress?: string | number;
    status?: string;
    target_date?: string;
    notes?: string;
  },
  opts: { requireName?: boolean } = {},
): void {
  if (fields.name !== undefined || opts.requireName) {
    properties.Goal = { title: textItems(fields.name ?? "") };
  }
  if (fields.area !== undefined) {
    properties.Area = { select: { name: fields.area } };
  }
  if (fields.status !== undefined) {
    properties.Status = { select: { name: fields.status } };
  }
  if (fields.metric !== undefined) {
    properties.Metric = { rich_text: textItems(fields.metric) };
  }
  if (fields.notes !== undefined) {
    properties.Notes = { rich_text: textItems(fields.notes) };
  }
  const progressValue = progressNumber(fields.progress);
  if (progressValue !== undefined) {
    properties.Progress = { number: progressValue };
  }
  if (fields.target_date !== undefined) {
    const normDue = normalizeNotionDue(fields.target_date);
    if (normDue) properties["Target Date"] = { date: { start: normDue } };
  }
}

async function goalNameById(
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<Map<string, string> | null> {
  if (!config.notionGoalsDataSourceId) return null;
  try {
    const goals = await listGoals(config, fetchImpl);
    return new Map(goals.map((g) => [g.id, g.name]));
  } catch (error) {
    console.error(
      "listGoals failed during project enrichment:",
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
}

export async function listGoals(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<GoalRecord[]> {
  if (!config.notionGoalsDataSourceId) return [];

  const pages: any[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore && pages.length < GOALS_MAX_ITEMS) {
    const body: Record<string, unknown> = { page_size: GOALS_PAGE_SIZE };
    if (startCursor) body.start_cursor = startCursor;

    const result = await notionRequest<{
      results: any[];
      next_cursor: string | null;
      has_more: boolean;
    }>(
      config,
      `/data_sources/${config.notionGoalsDataSourceId}/query`,
      { method: "POST", body: JSON.stringify(body) },
      fetchImpl,
    );

    pages.push(...result.results);
    hasMore = Boolean(result.has_more) && Boolean(result.next_cursor);
    startCursor = result.next_cursor ?? undefined;
  }

  return pages
    .slice(0, GOALS_MAX_ITEMS)
    .map((page): GoalRecord | null => {
      const name = titleText(page.properties?.Goal);
      if (!name) return null;
      const area = page.properties?.Area?.select?.name;
      const status = page.properties?.Status?.select?.name;
      const metric = metricFromProperty(page.properties?.Metric);
      const progress = progressFromProperty(page.properties?.Progress);
      const targetDate = page.properties?.["Target Date"]?.date?.start;
      const notes = richText(page.properties?.Notes) || undefined;
      return {
        id: page.id,
        name,
        ...(typeof area === "string" ? { area } : {}),
        ...(typeof status === "string" ? { status } : {}),
        ...(metric !== undefined ? { metric } : {}),
        ...(progress !== undefined ? { progress } : {}),
        ...(typeof targetDate === "string" ? { targetDate } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
    })
    .filter((goal): goal is GoalRecord => goal !== null);
}

export async function createGoal(
  config: AppConfig,
  goal: {
    name: string;
    area?: string;
    metric?: string;
    progress?: string | number;
    status?: string;
    target_date?: string;
    notes?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!config.notionGoalsDataSourceId) {
    throw new NotionRejectionError("Goals data source is not configured");
  }
  const properties: Record<string, unknown> = {};
  applyGoalWriteProperties(properties, goal, { requireName: true });
  const result = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.notionGoalsDataSourceId },
      properties,
    }),
  }, fetchImpl);
  return result.id;
}

export async function updateGoal(
  config: AppConfig,
  pageId: string,
  update: {
    name?: string;
    area?: string;
    metric?: string;
    progress?: string | number;
    status?: string;
    target_date?: string;
    notes?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const properties: Record<string, unknown> = {};
  applyGoalWriteProperties(properties, update);
  await notionRequest(config, `/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  }, fetchImpl);
}

export async function archiveGoal(
  config: AppConfig,
  pageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await notionRequest(config, `/blocks/${pageId}`, {
    method: "DELETE",
  }, fetchImpl);
}

export async function listProjects(
  config: AppConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ProjectRecord[]> {
  if (!config.notionProjectsDataSourceId) return [];

  const pages: any[] = [];
  let startCursor: string | undefined;
  let hasMore = true;

  while (hasMore && pages.length < PROJECTS_MAX_ITEMS) {
    const body: Record<string, unknown> = { page_size: PROJECTS_PAGE_SIZE };
    if (startCursor) body.start_cursor = startCursor;

    const result = await notionRequest<{
      results: any[];
      next_cursor: string | null;
      has_more: boolean;
    }>(
      config,
      `/data_sources/${config.notionProjectsDataSourceId}/query`,
      { method: "POST", body: JSON.stringify(body) },
      fetchImpl,
    );

    pages.push(...result.results);
    hasMore = Boolean(result.has_more) && Boolean(result.next_cursor);
    startCursor = result.next_cursor ?? undefined;
  }

  const goalsConfigured = Boolean(config.notionGoalsDataSourceId);
  const byGoalId = goalsConfigured ? await goalNameById(config, fetchImpl) : null;

  return pages
    .slice(0, PROJECTS_MAX_ITEMS)
    .map((page): ProjectRecord | null => {
      const name = titleText(page.properties?.Project);
      if (!name) return null;
      const area = page.properties?.Area?.select?.name;
      const project: ProjectRecord = {
        id: page.id,
        name,
        ...(typeof area === "string" ? { area } : {}),
      };
      if (byGoalId) {
        const rel = page.properties?.[PROJECT_GOAL_PROPERTY]?.relation;
        const goalId = Array.isArray(rel) && rel[0]?.id ? (rel[0].id as string) : null;
        project.goalId = goalId;
        project.goalName = goalId ? (byGoalId.get(goalId) ?? null) : null;
      }
      return project;
    })
    .filter((project): project is ProjectRecord => project !== null);
}

export async function createProject(
  config: AppConfig,
  project: { name: string; area?: string; deadline?: string; goalId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!config.notionProjectsDataSourceId) {
    throw new NotionRejectionError("Projects data source is not configured");
  }
  const properties: Record<string, unknown> = {
    Project: { title: textItems(project.name) },
  };
  if (project.area) {
    properties.Area = { select: { name: project.area } };
  }
  const normDue = normalizeNotionDue(project.deadline);
  if (normDue) {
    properties.Deadline = { date: { start: normDue } };
  }
  if (project.goalId) {
    properties[PROJECT_GOAL_PROPERTY] = { relation: [{ id: project.goalId }] };
  }
  const result = await notionRequest<{ id: string }>(config, "/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.notionProjectsDataSourceId },
      properties,
    }),
  }, fetchImpl);
  return result.id;
}

export async function updateProject(
  config: AppConfig,
  pageId: string,
  update: { name?: string; area?: string; deadline?: string; goalId?: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (update.name !== undefined) {
    properties.Project = { title: textItems(update.name) };
  }
  if (update.area !== undefined) {
    properties.Area = { select: { name: update.area } };
  }
  if (update.deadline !== undefined) {
    const normDue = normalizeNotionDue(update.deadline);
    if (normDue) properties.Deadline = { date: { start: normDue } };
  }
  if (update.goalId !== undefined) {
    properties[PROJECT_GOAL_PROPERTY] = {
      relation: update.goalId ? [{ id: update.goalId }] : [],
    };
  }
  await notionRequest(config, `/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  }, fetchImpl);
}

export async function archiveProject(
  config: AppConfig,
  pageId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await notionRequest(config, `/blocks/${pageId}`, {
    method: "DELETE",
  }, fetchImpl);
}

function projectFieldsFromPage(
  page: any,
  byId: Map<string, string> | null,
): { projectId: string | null; projectName: string | null } | Record<string, never> {
  if (!byId) return {};
  const rel = page.properties?.[TASK_PROJECT_PROPERTY]?.relation;
  const projectId = Array.isArray(rel) && rel[0]?.id ? (rel[0].id as string) : null;
  const projectName = projectId ? (byId.get(projectId) ?? null) : null;
  return { projectId, projectName };
}

async function projectNameById(
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<Map<string, string> | null> {
  if (!config.notionProjectsDataSourceId) return null;
  try {
    const projects = await listProjects(config, fetchImpl);
    return new Map(projects.map((p) => [p.id, p.name]));
  } catch (error) {
    console.error(
      "listProjects failed during task enrichment:",
      error instanceof Error ? error.message : error,
    );
    // Empty map: still extract projectId from relations; projectName stays null.
    return new Map();
  }
}

export async function createTask(
  config: AppConfig,
  task: { task: string; priority: Priority; due_date?: string; due_time?: string; notes?: string; projectId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const cleanTitle = stripDeadlineLeakFromTitle(task.task);
  const properties: Record<string, unknown> = {
    Task: { title: textItems(cleanTitle) }, Status: { select: { name: "To Do" } }, Priority: { select: { name: task.priority } }, Source: { select: { name: "Telegram" } },
  };
  const combinedDue = task.due_time && task.due_date ? `${task.due_date}T${task.due_time}:00+07:00` : task.due_date;
  const normDue = normalizeNotionDue(combinedDue);
  if (normDue) properties.Due = { date: { start: normDue } };
  const notes = typeof task.notes === "string" ? task.notes.trim() : "";
  if (notes) {
    properties.Notes = { rich_text: textItems(notes) };
  }
  if (task.projectId && config.notionProjectsDataSourceId) {
    properties[TASK_PROJECT_PROPERTY] = { relation: [{ id: task.projectId }] };
  }
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

  const byId = await projectNameById(config, fetchImpl);
  const rank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return result.results.map((page): TaskRecord | null => {
    const status = page.properties?.Status?.select?.name;
    const priority = page.properties?.Priority?.select?.name;
    if (statusFilter && status !== statusFilter) return null;
    if (!statusFilter && status !== "To Do" && status !== "Doing") return null;
    if (priority !== "Low" && priority !== "Medium" && priority !== "High") return null;
    const due = page.properties?.Due?.date?.start;
    return {
      id: page.id,
      task: titleText(page.properties?.Task),
      status,
      priority,
      ...(typeof due === "string" ? { due } : {}),
      ...projectFieldsFromPage(page, byId),
    };
  }).filter((task): task is TaskRecord => task !== null && task.task !== "").sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export async function getUpcomingTasks(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<TaskRecord[]> {
  return listActiveTasks(config, undefined, fetchImpl);
}

export async function getAllTasks(config: AppConfig, fetchImpl: typeof fetch = fetch): Promise<TaskRecord[]> {
  const result = await notionRequest<{ results: any[] }>(config, `/data_sources/${config.notionTasksDataSourceId}/query`, {
    method: "POST", body: JSON.stringify({ page_size: 100 }),
  }, fetchImpl);

  const byId = await projectNameById(config, fetchImpl);
  const rank: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return result.results.map((page): TaskRecord | null => {
    const status = page.properties?.Status?.select?.name;
    const priority = page.properties?.Priority?.select?.name;
    if (priority !== "Low" && priority !== "Medium" && priority !== "High") return null;
    const due = page.properties?.Due?.date?.start;
    return {
      id: page.id,
      task: titleText(page.properties?.Task),
      status,
      priority,
      ...(typeof due === "string" ? { due } : {}),
      ...projectFieldsFromPage(page, byId),
    };
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

const MEMORY_CATEGORIES: ReadonlySet<MemoryCategory> = new Set([
  "Identity", "Preference", "Goal", "Project", "Pattern", "Other", "Profile",
]);

function isMemoryCategory(value: string): value is MemoryCategory {
  return MEMORY_CATEGORIES.has(value as MemoryCategory);
}

function mapMemory(page: any): MemoryRecord | null {
  const key = titleText(page.properties?.Key);
  const value = richText(page.properties?.Value);
  const category = page.properties?.Category?.select?.name;
  if (!key || !value || typeof category !== "string" || !isMemoryCategory(category)) return null;
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
