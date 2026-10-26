import { describe, expect, it } from "vitest";
import { createCareerRecord, createHealthRecord, createReflectionRecord, NotionRejectionError } from "../src/notion";
import type { AppConfig } from "../src/types";

const config = {
  notionApiKey: "secret-key",
  notionVersion: "2026-03-11",
  notionHealthDataSourceId: "ds-health",
  notionCareerDataSourceId: "ds-career",
  notionReflectionDataSourceId: "ds-reflection",
} as AppConfig;

function captureFetch() {
  let body: any = null;
  const fetchImpl: typeof fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "page-1" }), { status: 200 });
  };
  return { fetchImpl, read: () => body };
}

describe("Notion life logs", () => {
  it("creates a sleep entry without turning it into a task", async () => {
    const captured = captureFetch();
    await createHealthRecord(config, { name: "tidur", kind: "Sleep", date: "2026-10-06", hours: 7 }, captured.fetchImpl);
    expect(captured.read().parent.data_source_id).toBe("ds-health");
    expect(captured.read().properties.Kind.select.name).toBe("Sleep");
    expect(captured.read().properties.Hours.number).toBe(7);
  });

  it("creates career evidence with a URL property", async () => {
    const captured = captureFetch();
    await createCareerRecord(config, { name: "Portfolio IoT", url: "https://example.com/iot", date: "2026-10-06" }, captured.fetchImpl);
    expect(captured.read().parent.data_source_id).toBe("ds-career");
    expect(captured.read().properties.URL.url).toBe("https://example.com/iot");
  });

  it("creates a reflection page with the five review fields", async () => {
    const captured = captureFetch();
    await createReflectionRecord(config, {
      name: "Minggu 2026-10-05",
      learned: "MQTT",
      built: "simulasi",
      income: "tidak ada",
      timeWasted: "scroll",
      improve: "tidur lebih awal",
      date: "2026-10-05",
    }, captured.fetchImpl);
    expect(captured.read().parent.data_source_id).toBe("ds-reflection");
    expect(captured.read().properties.Learned.rich_text[0].text.content).toBe("MQTT");
    expect(captured.read().properties["Time Wasted"].rich_text[0].text.content).toBe("scroll");
  });

  it("rejects a health write when the data source is unset", async () => {
    await expect(createHealthRecord({ ...config, notionHealthDataSourceId: null }, {
      name: "tidur",
      kind: "Sleep",
      date: "2026-10-06",
    })).rejects.toBeInstanceOf(NotionRejectionError);
  });
});
