import { afterEach, describe, expect, it } from "vitest";
import { loadQwenPlannerConfigFromEnv } from "../../../src/agent/demo/qwen-planner";

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("loadQwenPlannerConfigFromEnv", () => {
  it("treats blank optional env vars as unset so defaults still apply", () => {
    process.env.QWEN_API_KEY = "test-key";
    process.env.QWEN_MODEL = "";
    process.env.QWEN_BASE_URL = " ";
    process.env.QWEN_MAX_TOKENS = "";

    const config = loadQwenPlannerConfigFromEnv();

    expect(config).toMatchObject({
      apiKey: "test-key",
      model: "qwen-plus",
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      maxTokens: 2500,
    });
  });

  it("falls back for invalid numeric optional env vars", () => {
    process.env.QWEN_API_KEY = "test-key";
    process.env.QWEN_TIMEOUT_MS = "not-a-number";

    const config = loadQwenPlannerConfigFromEnv();

    expect(config?.timeoutMs).toBe(60000);
  });
});
