import { expect, it, vi } from "vitest";
import type { AppConfig } from "../src/types";
import { formatMemoriesForPrompt, generateChatReply, GeminiApiError } from "../src/gemini";

const config = { geminiApiKey: "gemini-key", geminiModel: "gemini-3.5-flash-lite" } as AppConfig;
function interaction(text: string): Response {
  return new Response(JSON.stringify({ 
    candidates: [{ content: { parts: [{ text }] } }]
  }), { status: 200 });
}

it("formatMemoriesForPrompt groups by category and caps lines", () => {
  const formatted = formatMemoriesForPrompt([
    { id: "1", key: "universitas", value: "UNY", category: "Identity" },
    { id: "2", key: "makanan", value: "nasi goreng", category: "Preference" },
    { id: "3", key: "legacy", value: "old row", category: "Profile" },
  ]);
  expect(formatted.indexOf("[Identity]")).toBeLessThan(formatted.indexOf("[Preference]"));
  expect(formatted).toContain("[Profile]");
  expect(formatted.split("\n").length).toBeLessThanOrEqual(12);
});

it("builds a stateless chat prompt with task and memory context", async () => {
  let requestBody: any;
  const fakeFetch: typeof fetch = async (_input, init) => { requestBody = JSON.parse(String(init?.body)); return interaction("Kerjakan tugas prioritas High terlebih dahulu."); };
  const reply = await generateChatReply(config, { text: "Mulai dari mana?" }, {
    tasks: [{ id: "1", task: "Revisi Bab 2", status: "To Do", priority: "High" }],
    memories: [{ id: "2", key: "topik", value: "personal AI", category: "Project" }],
  }, undefined, fakeFetch);
  
  if (reply.type === "text") {
    expect(reply.text).toContain("prioritas High");
  } else {
    expect.fail("Expected text reply");
  }
  expect(requestBody.systemInstruction.parts[0].text).toContain("asisten pribadi");
  expect(requestBody.systemInstruction.parts[0].text).toContain("MEMORY 2.0");
  expect(requestBody.systemInstruction.parts[0].text).toContain("[Project]");
});

it("extracts function calls correctly", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ 
    candidates: [{ 
      content: { 
        parts: [{ 
          functionCall: { name: "update_notion_task", args: { taskId: "123", priority: "High" } } 
        }] 
      } 
    }] 
  }), { status: 200 });
  
  const reply = await generateChatReply(config, { text: "Ubah prioritas jadi High" }, { tasks: [], memories: [] }, undefined, fakeFetch);
  expect(reply).toEqual({ type: "function_calls", calls: [{ name: "update_notion_task", args: { taskId: "123", priority: "High" } }] });
});

it("classifies 'not available in your current location' as LOCATION_UNSUPPORTED", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: 400, message: "This API is not available in your current location.", status: "FAILED_PRECONDITION" }
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await generateChatReply(config, { text: "Halo" }, { tasks: [], memories: [] }, undefined, fakeFetch);
    expect.fail("should throw");
  } catch (err) {
    expect(err).toBeInstanceOf(GeminiApiError);
    expect((err as GeminiApiError).type).toBe("LOCATION_UNSUPPORTED");
  }
  spy.mockRestore();
});

it("classifies media 'User location is not supported' as LOCATION_UNSUPPORTED", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: 400, message: "User location is not supported for the API use.", status: "FAILED_PRECONDITION" }
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await generateChatReply(config, { text: "lihat foto", imageBase64: "abc" }, { tasks: [], memories: [] }, undefined, fakeFetch);
    expect.fail("should throw");
  } catch (err) {
    expect(err).toBeInstanceOf(GeminiApiError);
    expect((err as GeminiApiError).type).toBe("LOCATION_UNSUPPORTED");
  }
  spy.mockRestore();
});

it("logs sanitized diagnostic when Gemini API fails", async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: 400, message: "Example Gemini diagnostic message secret_123", status: "INVALID_ARGUMENT" }
  }), { status: 400 });
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(generateChatReply(config, { text: "fail test" }, { tasks: [], memories: [] }, undefined, fakeFetch)).rejects.toThrow("Gemini API failed: HTTP 400");
  expect(spy).toHaveBeenCalled();
  const logArgs = String(spy.mock.calls[0]?.[0] ?? "");
  expect(logArgs).toContain("HTTP=400");
  expect(logArgs).toContain("<REDACTED>");
  expect(logArgs).not.toContain("secret_123");
  spy.mockRestore();
});
