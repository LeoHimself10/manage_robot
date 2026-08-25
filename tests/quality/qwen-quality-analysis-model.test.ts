import { describe, expect, it } from "vitest";
import { loadQwenQualityAnalysisConfig } from
  "../../src/quality/analysis/qwen-quality-analysis-model";

describe("quality analysis Qwen configuration", () => {
  it("does not inherit an ordinary 60 second budget for quality analysis", () => {
    const config = loadQwenQualityAnalysisConfig({
      QWEN_API_KEY: "test-key",
      QWEN_TIMEOUT_MS: "60000",
    });
    expect(config?.clientConfig.timeoutMs).toBe(120_000);
  });

  it("keeps an explicit value within the shared client's safe upper bound", () => {
    const config = loadQwenQualityAnalysisConfig({
      QWEN_API_KEY: "test-key",
      QWEN_TIMEOUT_MS: "60000",
      QUALITY_ANALYSIS_QWEN_TIMEOUT_MS: "180000",
    });
    expect(config?.clientConfig.timeoutMs).toBe(120_000);
  });
});
