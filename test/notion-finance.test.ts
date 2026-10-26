import { describe, it, expect, vi } from "vitest";
import { createFinanceRecord, listFinanceRecords, NotionRejectionError } from "../src/notion";
import type { AppConfig } from "../src/types";

const mockConfig = {
  notionApiKey: "secret-key",
  notionVersion: "2026-03-11",
  notionFinanceDataSourceId: "ds-finance-1",
} as AppConfig;

const mockConfigUnset = {
  notionApiKey: "secret-key",
  notionVersion: "2026-03-11",
  notionFinanceDataSourceId: null,
  notionHealthDataSourceId: null,
  notionCareerDataSourceId: null,
  notionReflectionDataSourceId: null,
} as AppConfig;

describe("Notion Finance API", () => {
  it("creates a finance expense record with correct payload", async () => {
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        id: "page-123",
        properties: {
          Name: { title: [{ plain_text: "Makan Siang" }] },
          Amount: { number: 25000 },
          Currency: { select: { name: "IDR" } },
          Type: { select: { name: "Expense" } },
          Category: { select: { name: "Food" } },
          Date: { date: { start: "2026-10-05T12:30:00+07:00" } },
          Notes: { rich_text: [{ plain_text: "Kenyang" }] },
        }
      }), { status: 200 });
    };

    const res = await createFinanceRecord(mockConfig, {
      name: "Makan Siang",
      amount: 25000,
      currency: "IDR",
      type: "Expense",
      category: "Food",
      date: "2026-10-05T12:30:00+07:00",
      notes: "Kenyang",
    }, fakeFetch);

    expect(capturedBody.parent.data_source_id).toBe("ds-finance-1");
    expect(capturedBody.properties.Amount.number).toBe(25000);
    expect(capturedBody.properties.Type.select.name).toBe("Expense");
    expect(capturedBody.properties.Date.date.start).toBe("2026-10-05T12:30:00+07:00");
    expect(res.id).toBe("page-123");
  });

  it("keeps a past-month finance date instead of rewriting it to today", async () => {
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "page-old" }), { status: 200 });
    };

    await createFinanceRecord(mockConfig, {
      name: "Listrik",
      amount: 150000,
      currency: "IDR",
      type: "Expense",
      category: "Bills",
      date: "2026-09-15T22:00:00+07:00",
    }, fakeFetch);

    expect(capturedBody.properties.Date.date.start).toBe("2026-09-15T22:00:00+07:00");
  });

  it("treats a timezone-less finance datetime as WIB", async () => {
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: "page-naive" }), { status: 200 });
    };

    await createFinanceRecord(mockConfig, {
      name: "Makan",
      amount: 15000,
      currency: "IDR",
      type: "Expense",
      category: "Food",
      date: "2026-10-05T12:00:00",
    }, fakeFetch);

    expect(capturedBody.properties.Date.date.start).toBe("2026-10-05T12:00:00+07:00");
  });

  it("throws NotionRejectionError when creating record if data source is unset", async () => {
    await expect(
      createFinanceRecord(mockConfigUnset, {
        name: "Test",
        amount: 1000,
        currency: "IDR",
        type: "Expense",
        category: "Other",
        date: "2026-10-05",
      })
    ).rejects.toThrow(NotionRejectionError);
  });

  it("lists and filters finance records", async () => {
    let capturedUrl = "";
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        results: [
          {
            id: "page-1",
            properties: {
              Name: { title: [{ plain_text: "Project Bonus" }] },
              Amount: { number: 1000000 },
              Currency: { select: { name: "IDR" } },
              Type: { select: { name: "Income" } },
              Category: { select: { name: "Client/Project" } },
              Date: { date: { start: "2026-10-05T10:00:00+07:00" } },
            }
          }
        ]
      }), { status: 200 });
    };

    const list = await listFinanceRecords(mockConfig, { type: "Income" }, fakeFetch);
    expect(capturedUrl).toContain("/data_sources/ds-finance-1/query");
    expect(capturedBody.filter).toEqual({
      property: "Type",
      select: { equals: "Income" },
    });
    expect(list.length).toBe(1);
    expect(list[0]!.amount).toBe(1000000);
    expect(list[0]!.type).toBe("Income");
  });

  it("returns [] without network call when data source is unset", async () => {
    let called = false;
    const fakeFetch: typeof fetch = async () => {
      called = true;
      return new Response(JSON.stringify({ results: [] }));
    };
    const list = await listFinanceRecords(mockConfigUnset, undefined, fakeFetch);
    expect(list).toEqual([]);
    expect(called).toBe(false);
  });

  it("builds composite filters with and operator", async () => {
    let capturedBody: any = null;
    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    };

    await listFinanceRecords(mockConfig, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      type: "Expense",
      category: "Food",
    }, fakeFetch);

    expect(capturedBody.filter.and).toEqual([
      { property: "Date", date: { on_or_after: "2026-10-01" } },
      { property: "Date", date: { on_or_before: "2026-10-31" } },
      { property: "Type", select: { equals: "Expense" } },
      { property: "Category", select: { equals: "Food" } },
    ]);
  });
});
