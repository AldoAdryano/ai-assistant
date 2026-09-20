import { expect, it } from "vitest";
import type { AppConfig } from "../src/types";
import {
  NotionRejectionError,
  archiveLearning,
  createLearning,
  listLearning,
  updateLearning,
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
  notionLearningDataSourceId: null,
  whatsappApiSecret: "w-sec",
  allowedWhatsappNumber: "w-num",
  allowedWhatsappIdentities: ["w-num"],
};

const configWithLearning: AppConfig = {
  ...baseConfig,
  notionLearningDataSourceId: "learning-ds",
};

it("listLearning returns [] without fetch when learning data source is unset", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  };
  const skills = await listLearning(baseConfig, fakeFetch);
  expect(skills).toEqual([]);
  expect(called).toBe(false);
});

it("listLearning maps Skill title and optional fields", async () => {
  let url = "";
  const fakeFetch: typeof fetch = async (input) => {
    url = String(input);
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "skill-1",
            properties: {
              Skill: { title: [{ plain_text: "MQTT" }] },
              Area: { select: { name: "Embedded" } },
              Status: { select: { name: "In progress" } },
              Level: { number: 2 },
              Target: { rich_text: [{ plain_text: "Build broker" }] },
              Resource: { url: "https://mqtt.org/docs" },
              "Last Practiced": { date: { start: "2026-09-18" } },
            },
          },
          {
            id: "skill-2",
            properties: {
              Skill: { title: [{ plain_text: "Python" }] },
              Level: { rich_text: [{ plain_text: "beginner" }] },
              Resource: { rich_text: [{ plain_text: "local notes" }] },
            },
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
      { status: 200 },
    );
  };

  const skills = await listLearning(configWithLearning, fakeFetch);
  expect(url).toBe("https://api.notion.com/v1/data_sources/learning-ds/query");
  expect(skills).toEqual([
    {
      id: "skill-1",
      name: "MQTT",
      area: "Embedded",
      status: "In progress",
      level: 2,
      target: "Build broker",
      resource: "https://mqtt.org/docs",
      lastPracticed: "2026-09-18",
    },
    {
      id: "skill-2",
      name: "Python",
      level: "beginner",
      resource: "local notes",
    },
  ]);
});

it("listLearning follows next_cursor until exhausted", async () => {
  const bodies: unknown[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    if (bodies.length === 1) {
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "skill-1",
              properties: { Skill: { title: [{ plain_text: "Page One" }] } },
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
            id: "skill-2",
            properties: { Skill: { title: [{ plain_text: "Page Two" }] } },
          },
        ],
        has_more: false,
        next_cursor: null,
      }),
      { status: 200 },
    );
  };

  const skills = await listLearning(configWithLearning, fakeFetch);
  expect(bodies).toEqual([
    { page_size: 100 },
    { page_size: 100, start_cursor: "cursor-abc" },
  ]);
  expect(skills).toEqual([
    { id: "skill-1", name: "Page One" },
    { id: "skill-2", name: "Page Two" },
  ]);
});

it("createLearning posts title Skill and optional fields", async () => {
  let url = "";
  let method = "";
  let body: any;
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-new" }), { status: 200 });
  };

  const id = await createLearning(
    configWithLearning,
    {
      name: "MQTT",
      area: "Embedded",
      level: 2,
      status: "In progress",
      target: "Build broker",
      resource: "https://mqtt.org/docs",
      last_practiced: "2026-09-18",
    },
    fakeFetch,
  );

  expect(id).toBe("skill-new");
  expect(method).toBe("POST");
  expect(url).toBe("https://api.notion.com/v1/pages");
  expect(body.parent).toEqual({ type: "data_source_id", data_source_id: "learning-ds" });
  expect(body.properties.Skill.title[0].text.content).toBe("MQTT");
  expect(body.properties.Area).toEqual({ select: { name: "Embedded" } });
  expect(body.properties.Status).toEqual({ select: { name: "In progress" } });
  expect(body.properties.Level).toEqual({ number: 2 });
  expect(body.properties.Target.rich_text[0].text.content).toBe("Build broker");
  expect(body.properties.Resource).toEqual({ url: "https://mqtt.org/docs" });
  expect(body.properties["Last Practiced"]).toEqual({ date: { start: "2026-09-18" } });
});

it("createLearning writes Level as number when level is numeric string", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-num" }), { status: 200 });
  };

  await createLearning(configWithLearning, { name: "Numeric level", level: "3" }, fakeFetch);
  expect(body.properties.Level).toEqual({ number: 3 });
});

it("createLearning skips Level when not a finite number", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-skip" }), { status: 200 });
  };

  await createLearning(
    configWithLearning,
    { name: "Skip level", level: "advanced", area: "Work" },
    fakeFetch,
  );
  expect(body.properties.Level).toBeUndefined();
  expect(body.properties.Area).toEqual({ select: { name: "Work" } });
});

it("createLearning writes Resource as rich_text when not a URL", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-res" }), { status: 200 });
  };

  await createLearning(
    configWithLearning,
    { name: "Notes resource", resource: "local notes" },
    fakeFetch,
  );
  expect(body.properties.Resource.rich_text[0].text.content).toBe("local notes");
});

it("createLearning omits optional fields when not provided", async () => {
  let body: any;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-min" }), { status: 200 });
  };

  await createLearning(configWithLearning, { name: "Solo Skill" }, fakeFetch);
  expect(body.properties.Skill.title[0].text.content).toBe("Solo Skill");
  expect(body.properties.Area).toBeUndefined();
  expect(body.properties.Level).toBeUndefined();
  expect(body.properties.Status).toBeUndefined();
  expect(body.properties.Target).toBeUndefined();
  expect(body.properties.Resource).toBeUndefined();
  expect(body.properties["Last Practiced"]).toBeUndefined();
});

it("createLearning throws NotionRejectionError when learning data source unset", async () => {
  let called = false;
  const fakeFetch: typeof fetch = async () => {
    called = true;
    return new Response(JSON.stringify({ id: "x" }), { status: 200 });
  };

  await expect(
    createLearning(baseConfig, { name: "Should Fail" }, fakeFetch),
  ).rejects.toThrow(NotionRejectionError);
  expect(called).toBe(false);
});

it("updateLearning PATCHes provided fields including Level number and Last Practiced", async () => {
  let url = "";
  let method = "";
  let body: any;
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "skill-1" }), { status: 200 });
  };

  await updateLearning(
    configWithLearning,
    "skill-1",
    {
      name: "MQTT Advanced",
      area: "Embedded",
      level: 3,
      status: "In progress",
      target: "Ship project",
      resource: "https://mqtt.org/docs",
      last_practiced: "2026-09-20",
    },
    fakeFetch,
  );

  expect(method).toBe("PATCH");
  expect(url).toBe("https://api.notion.com/v1/pages/skill-1");
  expect(body.properties.Skill.title[0].text.content).toBe("MQTT Advanced");
  expect(body.properties.Area).toEqual({ select: { name: "Embedded" } });
  expect(body.properties.Status).toEqual({ select: { name: "In progress" } });
  expect(body.properties.Level).toEqual({ number: 3 });
  expect(body.properties.Target.rich_text[0].text.content).toBe("Ship project");
  expect(body.properties.Resource).toEqual({ url: "https://mqtt.org/docs" });
  expect(body.properties["Last Practiced"]).toEqual({ date: { start: "2026-09-20" } });
});

it("archiveLearning DELETEs the learning block", async () => {
  let url = "";
  let method = "";
  const fakeFetch: typeof fetch = async (input, init) => {
    url = String(input);
    method = init?.method || "GET";
    return new Response(JSON.stringify({ id: "skill-1" }), { status: 200 });
  };

  await archiveLearning(configWithLearning, "skill-1", fakeFetch);

  expect(method).toBe("DELETE");
  expect(url).toBe("https://api.notion.com/v1/blocks/skill-1");
});
