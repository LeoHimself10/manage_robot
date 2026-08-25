import { describe, expect, it } from "vitest";
import { loadQwenQualityAnalysisConfig } from
  "../../src/quality/analysis/qwen-quality-analysis-model";

describe("quality analysis Qwen configuration", () => {
  it("uses a bounded one-shot configuration instead of extending the wait", () => {
    const config = loadQwenQualityAnalysisConfig({
      QWEN_API_KEY: "test-key",
      QWEN_TIMEOUT_MS: "60000",
      QWEN_MAX_TOKENS: "8000",
      QWEN_MAX_RETRIES: "1",
    });
    expect(config?.clientConfig).toMatchObject({
      timeoutMs: 60_000,
      maxRetries: 0,
      maxTokens: 3_500,
      stream: false,
      thinking: false,
    });
  });

  it("accepts a quality-specific timeout but caps output tokens", () => {
    const config = loadQwenQualityAnalysisConfig({
      QWEN_API_KEY: "test-key",
      QWEN_TIMEOUT_MS: "60000",
      QUALITY_ANALYSIS_QWEN_TIMEOUT_MS: "90000",
      QUALITY_ANALYSIS_QWEN_MAX_TOKENS: "9000",
    });
    expect(config?.clientConfig.timeoutMs).toBe(90_000);
    expect(config?.clientConfig.maxTokens).toBe(4_000);
  });
});
