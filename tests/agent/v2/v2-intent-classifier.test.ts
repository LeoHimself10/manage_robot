import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyRowSplitIntent } from "../../../src/agent/v2/intent-classifier";

const CONFIG = {
  apiKey: "test-key",
  baseUrl: "https://example.com/v1",
  model: "qwen-doc-turbo",
  timeoutMs: 5000,
};

function mockFetchResponse(content: string, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok,
    status,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  } as Response);
}

describe("classifyRowSplitIntent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns other for empty message", async () => {
    expect(await classifyRowSplitIntent("", CONFIG)).toBe("other");
  });

  it("returns other when config missing", async () => {
    expect(await classifyRowSplitIntent("split task 2", undefined)).toBe("other");
  });

  it("parses split intent from JSON", async () => {
    mockFetchResponse('{"intent":"split"}');
    expect(await classifyRowSplitIntent("split task 2 into two packages", CONFIG)).toBe(
      "split",
    );
  });

  it("parses other intent from JSON", async () => {
    mockFetchResponse('{"intent":"other"}');
    expect(await classifyRowSplitIntent("confirm publish please", CONFIG)).toBe("other");
  });

  it("parses fenced JSON block", async () => {
    mockFetchResponse('```json\n{"intent":"split"}\n```');
    expect(await classifyRowSplitIntent("把任务2拆成两条", CONFIG)).toBe("split");
  });

  it("fail-open on HTTP error", async () => {
    mockFetchResponse("", false, 500);
    expect(await classifyRowSplitIntent("split task 2", CONFIG)).toBe("other");
  });

  it("fail-open on invalid JSON", async () => {
    mockFetchResponse("not json");
    expect(await classifyRowSplitIntent("split task 2", CONFIG)).toBe("other");
  });

  it("fail-open on network abort", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("aborted"));
    expect(await classifyRowSplitIntent("split task 2", CONFIG)).toBe("other");
  });
});
