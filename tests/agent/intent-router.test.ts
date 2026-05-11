import { afterEach, describe, expect, it, vi } from "vitest";

import { routeIntentWithModel } from "../../src/agent/intent-router";

describe("routeIntentWithModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns SMALL_TALK when model classifies greeting chat", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                route: "SMALL_TALK",
                reply: "你好，我在线。请告诉我这次要处理的新任务。",
                confidence: "HIGH",
                reason: "greeting_only",
              }),
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await routeIntentWithModel(
      { userMessage: "hi" },
      {
        baseUrl: "https://example.com/v1",
        apiKey: "k",
        model: "m",
        timeoutMs: 30000,
        maxRetries: 0,
        temperature: 0,
        maxTokens: 1000,
      },
    );

    expect(result.route).toBe("SMALL_TALK");
    expect(result.reply).toContain("你好");
  });

  it("defaults to TASK_FLOW for unexpected route values", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                route: "UNKNOWN",
                reply: "",
                confidence: "LOW",
                reason: "ambiguous",
              }),
            },
          },
        ],
      }),
    } as unknown as Response);

    const result = await routeIntentWithModel(
      { userMessage: "帮我拆解产线异常" },
      {
        baseUrl: "https://example.com/v1",
        apiKey: "k",
        model: "m",
        timeoutMs: 30000,
        maxRetries: 0,
        temperature: 0,
        maxTokens: 1000,
      },
    );

    expect(result.route).toBe("TASK_FLOW");
  });
});

