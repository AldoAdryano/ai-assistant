import { expect, it } from "vitest";
import type { AppConfig } from "../src/types";
import {
  TASK_PROJECT_PROPERTY,
  createTask,
  getAllTasks,
  listActiveTasks,
  listProjects,
} from "../src/notion";

const baseConfig: AppConfig = {
  geminiApiKey: "gemini-key",
  geminiModel: "gemini-3.5-flash-lite",
  notionApiKey: "notion-key",
  notionVersion: "2026-03-11",
  notionInboxDataSourceId: "inbox-ds",
  notionTasksDataSourceId: "tasks-ds",
  notionMemoryDataSourceId: "memory-ds",
  telegramBotToken: "123456:test",
  telegramWebhookSecret: "secret_123",
  allowedTelegramUserId: "111111111",
  notionRoutineDbId: "r-db",
  notionProjectsDataSourceId: null,
  whatsappApiSecret: "w-sec",
  allowedWhatsappNumber: "w-num",
  allowedWhatsappIdentities: ["w-num"],
};

const configWithProjects: AppConfig = {
  ...baseConfig,
  notionProjectsDataSourceId: "projects-ds",
};

it("listProjects returns [] without fetch when projects data source is unset", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const projects = await listProjects(baseConfig, fakeFetch);
  expect(projects).toEqual([]);
  expect(called).toBe(false);
});

it("listProjects maps Project title and optional Area", async () => {
  let url = "";
  const fakeFetch: typeof fetch = async (input) => {
    url = String(input);
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "proj-1",
            properties: {
              Project: { title: [{ plain_text: "Persiapan IKN" }] },
              Area: { select: { name: "Work" } },
            },
          },
          {
            id: "proj-2",
            properties: {
              Project: { title: [{ plain_text: "Portfolio" }] },
            },
          },
        ],
      }),
      { status: 200 },
    );
  };
  const projects = await listProjects(configWithProjects, fakeFetch);
  expect(url).toBe("https://api.notion.com/v1/data_sources/projects-ds/query");
  expect(projects).toEqual([
    { id: "proj-1", name: "Persiapan IKN", area: "Work" },
    { id: "proj-2", name: "Portfolio" },
  ]);
});

it("createTask includes Project relation when projectId set and projects enabled", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-task" }), { status: 200 });
  };
  await createTask(
    configWithProjects,
    { task: "Draft memo", priority: "High", projectId: "proj-1" },
    fakeFetch,
  );
  expect(body.properties[TASK_PROJECT_PROPERTY]).toEqual({
    relation: [{ id: "proj-1" }],
  });
});

it("createTask omits Project relation when projectId missing or projects disabled", async () => {
  let bodyEnabledNoId: any;
  let bodyDisabledWithId: any;
  const fakeFetchEnabled: typeof fetch = async (_input, init) => {
    bodyEnabledNoId = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-1" }), { status: 200 });
  };
  const fakeFetchDisabled: typeof fetch = async (_input, init) => {
    bodyDisabledWithId = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-2" }), { status: 200 });
  };

  await createTask(configWithProjects, { task: "No project", priority: "Low" }, fakeFetchEnabled);
  expect(bodyEnabledNoId.properties[TASK_PROJECT_PROPERTY]).toBeUndefined();

  await createTask(
    baseConfig,
    { task: "Soft disabled", priority: "Medium", projectId: "proj-1" },
    fakeFetchDisabled,
  );
  expect(bodyDisabledWithId.properties[TASK_PROJECT_PROPERTY]).toBeUndefined();
});

it("listActiveTasks fills projectId and projectName from relation + listProjects", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/tasks-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "task-1",
              properties: {
                Task: { title: [{ plain_text: "Linked task" }] },
                Status: { select: { name: "To Do" } },
                Priority: { select: { name: "High" } },
                Project: { relation: [{ id: "proj-1" }] },
              },
            },
            {
              id: "task-2",
              properties: {
                Task: { title: [{ plain_text: "Unlinked task" }] },
                Status: { select: { name: "Doing" } },
                Priority: { select: { name: "Medium" } },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/data_sources/projects-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "proj-1",
              properties: {
                Project: { title: [{ plain_text: "Persiapan IKN" }] },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const tasks = await listActiveTasks(configWithProjects, undefined, fakeFetch);
  expect(tasks).toEqual([
    {
      id: "task-1",
      task: "Linked task",
      status: "To Do",
      priority: "High",
      projectId: "proj-1",
      projectName: "Persiapan IKN",
    },
    {
      id: "task-2",
      task: "Unlinked task",
      status: "Doing",
      priority: "Medium",
      projectId: null,
      projectName: null,
    },
  ]);
});

it("getAllTasks maps project relation the same way", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/tasks-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "task-1",
              properties: {
                Task: { title: [{ plain_text: "Done linked" }] },
                Status: { select: { name: "Done" } },
                Priority: { select: { name: "Low" } },
                Project: { relation: [{ id: "proj-2" }] },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/data_sources/projects-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "proj-2",
              properties: {
                Project: { title: [{ plain_text: "Portfolio" }] },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const tasks = await getAllTasks(configWithProjects, fakeFetch);
  expect(tasks[0]).toMatchObject({
    id: "task-1",
    projectId: "proj-2",
    projectName: "Portfolio",
  });
});
