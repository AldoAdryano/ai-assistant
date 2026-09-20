import { expect, it } from "vitest";
import type { AppConfig } from "../src/types";
import {
  NotionRejectionError,
  archiveGoal,
  createGoal,
  createProject,
  listGoals,
  listProjects,
  updateGoal,
  updateProject,
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
  notionGoalsDataSourceId: null,
  whatsappApiSecret: "w-sec",
  allowedWhatsappNumber: "w-num",
  allowedWhatsappIdentities: ["w-num"],
};

const configWithGoals: AppConfig = {
  ...baseConfig,
  notionGoalsDataSourceId: "goals-ds",
};

const configWithProjectsAndGoals: AppConfig = {
  ...baseConfig,
  notionProjectsDataSourceId: "projects-ds",
  notionGoalsDataSourceId: "goals-ds",
};

it("listGoals returns [] without fetch when goals data source is unset", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const goals = await listGoals(baseConfig, fakeFetch);
  expect(goals).toEqual([]);
  expect(called).toBe(false);
});

it("listGoals maps Goal title and optional fields", async () => {
  let url = "";
  const fakeFetch: typeof fetch = async (input) => {
    url = String(input);
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "goal-1",
            properties: {
              Goal: { title: [{ plain_text: "Menguasai Embedded + IoT" }] },
              Area: { select: { name: "Belajar" } },
              Status: { select: { name: "In progress" } },
              Metric: { rich_text: [{ plain_text: "5 projects" }] },
              Progress: { number: 10 },
              "Target Date": { date: { start: "2026-12-31" } },
              Notes: { rich_text: [{ plain_text: "Focus ESP32" }] },
            },
          },
          {
            id: "goal-2",
            properties: {
              Goal: { title: [{ plain_text: "Income pertama" }] },
              Metric: { number: 100000 },
              Progress: { rich_text: [{ plain_text: "started" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
      { status: 200 },
    );
  };

  const goals = await listGoals(configWithGoals, fakeFetch);
  expect(url).toBe("https://api.notion.com/v1/data_sources/goals-ds/query");
  expect(goals).toEqual([
    {
      id: "goal-1",
      name: "Menguasai Embedded + IoT",
      area: "Belajar",
      status: "In progress",
      metric: "5 projects",
      progress: 10,
      targetDate: "2026-12-31",
      notes: "Focus ESP32",
    },
    {
      id: "goal-2",
      name: "Income pertama",
      metric: "100000",
      progress: "started",
    },
  ]);
});

it("listGoals follows next_cursor until exhausted", async () => {
  const bodies: unknown[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "goal-1",
              properties: { Goal: { title: [{ plain_text: "Page One" }] } },
            },
          ],
          has_more: true,
          next_cursor: "cursor-abc",
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "goal-2",
            properties: { Goal: { title: [{ plain_text: "Page Two" }] } },
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
      { status: 200 },
    );
  };

  const goals = await listGoals(configWithGoals, fakeFetch);
  expect(bodies).toEqual([
    { page_size: 100 },
    { page_size: 100, start_cursor: "cursor-abc" },
  ]);
  expect(goals).toEqual([
    { id: "goal-1", name: "Page One" },
    { id: "goal-2", name: "Page Two" },
  ]);
});

it("createGoal posts title Goal and optional Area/Progress/Target Date", async () => {
  let url = "";
  let method = "";
  let body: any;
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "goal-new" }), { status: 200 });
  };

  const id = await createGoal(
    configWithGoals,
    {
      name: "Menguasai Embedded + IoT",
      area: "Belajar",
      progress: 10,
      status: "In progress",
      target_date: "2026-12-31",
      metric: "5 projects",
      notes: "Focus ESP32",
    },
    fakeFetch,
  );

  expect(id).toBe("goal-new");
  expect(method).toBe("POST");
  expect(url).toBe("https://api.notion.com/v1/pages");
  expect(body.parent).toEqual({ type: "data_source_id", data_source_id: "goals-ds" });
  expect(body.properties.Goal.title[0].text.content).toBe("Menguasai Embedded + IoT");
  expect(body.properties.Area).toEqual({ select: { name: "Belajar" } });
  expect(body.properties.Status).toEqual({ select: { name: "In progress" } });
  expect(body.properties.Progress).toEqual({ number: 10 });
  expect(body.properties["Target Date"]).toEqual({ date: { start: "2026-12-31" } });
  expect(body.properties.Metric.rich_text[0].text.content).toBe("5 projects");
  expect(body.properties.Notes.rich_text[0].text.content).toBe("Focus ESP32");
});

it("createGoal writes Progress as number when progress is numeric string", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "goal-num" }), { status: 200 });
  };

  await createGoal(configWithGoals, { name: "Numeric progress", progress: "25" }, fakeFetch);
  expect(body.properties.Progress).toEqual({ number: 25 });
});

it("createGoal skips Progress when not a finite number", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "goal-skip" }), { status: 200 });
  };

  await createGoal(
    configWithGoals,
    { name: "Skip progress", progress: "almost done", area: "Work" },
    fakeFetch,
  );
  expect(body.properties.Progress).toBeUndefined();
  expect(body.properties.Area).toEqual({ select: { name: "Work" } });
});

it("createGoal omits optional fields when not provided", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "goal-min" }), { status: 200 });
  };

  await createGoal(configWithGoals, { name: "Solo Goal" }, fakeFetch);
  expect(body.properties.Goal.title[0].text.content).toBe("Solo Goal");
  expect(body.properties.Area).toBeUndefined();
  expect(body.properties.Progress).toBeUndefined();
  expect(body.properties["Target Date"]).toBeUndefined();
  expect(body.properties.Metric).toBeUndefined();
  expect(body.properties.Notes).toBeUndefined();
  expect(body.properties.Status).toBeUndefined();
});

it("createGoal throws NotionRejectionError when goals data source unset", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  };

  await expect(
    createGoal(baseConfig, { name: "Should Fail" }, fakeFetch),
  ).rejects.toThrow(NotionRejectionError);
  expect(called).toBe(false);
});

it("updateGoal PATCHes provided fields including Progress number and Target Date", async () => {
  let url = "";
  let method = "";
  let body: any;
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "goal-1" }), { status: 200 });
  };

  await updateGoal(
    configWithGoals,
    "goal-1",
    {
      name: "Menguasai Embedded + IoT 2026",
      area: "Belajar",
      progress: 15,
      status: "In progress",
      target_date: "2026-11-01",
      metric: "6 projects",
      notes: "Updated",
    },
    fakeFetch,
  );

  expect(method).toBe("PATCH");
  expect(url).toBe("https://api.notion.com/v1/pages/goal-1");
  expect(body.properties.Goal.title[0].text.content).toBe("Menguasai Embedded + IoT 2026");
  expect(body.properties.Area).toEqual({ select: { name: "Belajar" } });
  expect(body.properties.Status).toEqual({ select: { name: "In progress" } });
  expect(body.properties.Progress).toEqual({ number: 15 });
  expect(body.properties["Target Date"]).toEqual({ date: { start: "2026-11-01" } });
  expect(body.properties.Metric.rich_text[0].text.content).toBe("6 projects");
  expect(body.properties.Notes.rich_text[0].text.content).toBe("Updated");
});

it("archiveGoal DELETEs the goal block", async () => {
  let url = "";
  let method = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    return new Response(JSON.stringify({ id: "goal-1" }), { status: 200 });
  };

  await archiveGoal(configWithGoals, "goal-1", fakeFetch);

  expect(method).toBe("DELETE");
  expect(url).toBe("https://api.notion.com/v1/blocks/goal-1");
});

it("createProject includes Goal relation when goalId set", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "proj-new" }), { status: 200 });
  };

  await createProject(
    configWithProjectsAndGoals,
    { name: "Smart Room Monitor", goalId: "goal-1" },
    fakeFetch,
  );

  expect(body.properties.Goal).toEqual({ relation: [{ id: "goal-1" }] });
});

it("createProject omits Goal relation when goalId missing", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "proj-min" }), { status: 200 });
  };

  await createProject(
    configWithProjectsAndGoals,
    { name: "Solo Project" },
    fakeFetch,
  );
  expect(body.properties.Goal).toBeUndefined();
});

it("updateProject sets Goal relation when goalId is string", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "proj-1" }), { status: 200 });
  };

  await updateProject(
    configWithProjectsAndGoals,
    "proj-1",
    { goalId: "goal-1" },
    fakeFetch,
  );
  expect(body.properties.Goal).toEqual({ relation: [{ id: "goal-1" }] });
});

it("updateProject clears Goal relation when goalId is null", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "proj-1" }), { status: 200 });
  };

  await updateProject(
    configWithProjectsAndGoals,
    "proj-1",
    { goalId: null },
    fakeFetch,
  );
  expect(body.properties.Goal).toEqual({ relation: [] });
});

it("listProjects maps goalId and goalName when Goal relation present", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/projects-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "proj-1",
              properties: {
                Project: { title: [{ plain_text: "Smart Room Monitor" }] },
                Goal: { relation: [{ id: "goal-1" }] },
              },
            },
            {
              id: "proj-2",
              properties: {
                Project: { title: [{ plain_text: "Unlinked" }] },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/data_sources/goals-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "goal-1",
              properties: {
                Goal: { title: [{ plain_text: "Menguasai Embedded + IoT" }] },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const projects = await listProjects(configWithProjectsAndGoals, fakeFetch);
  expect(projects).toEqual([
    {
      id: "proj-1",
      name: "Smart Room Monitor",
      goalId: "goal-1",
      goalName: "Menguasai Embedded + IoT",
    },
    {
      id: "proj-2",
      name: "Unlinked",
      goalId: null,
      goalName: null,
    },
  ]);
});

it("listProjects soft-fails goal enrichment if goals list throws", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("/data_sources/projects-ds/query")) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "proj-1",
              properties: {
                Project: { title: [{ plain_text: "Smart Room Monitor" }] },
                Goal: { relation: [{ id: "goal-1" }] },
              },
            },
          ],
          has_more: false,
          next_cursor: null,
        }),
        { status: 200 },
      );
    }
    if (url.includes("/data_sources/goals-ds/query")) {
      throw new Error("Goals API unavailable");
    }
    throw new Error(`unexpected url: ${url}`);
  };

  const projects = await listProjects(configWithProjectsAndGoals, fakeFetch);
  expect(projects).toEqual([
    {
      id: "proj-1",
      name: "Smart Room Monitor",
      goalId: "goal-1",
      goalName: null,
    },
  ]);
});
