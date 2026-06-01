import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { scoreTurn, shouldSampleTurn } from "../../../src/agent/online-eval/turn-scorer";

describe("turn-scorer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("ONLINE_EVAL_ENABLED", "1");
    vi.stubEnv("ONLINE_EVAL_SAMPLE_RATE", "0");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("always samples incident flags", () => {
    expect(shouldSampleTurn(["false_publish_observed"])).toBe(true);
  });

  it("does not sample when disabled", () => {
    vi.stubEnv("ONLINE_EVAL_ENABLED", "0");
    expect(shouldSampleTurn(["false_publish_observed"])).toBe(false);
  });

  it("fails hygiene when tool name in message", () => {
    const result = scoreTurn({
      orchResult: { messages: [], traceId: "x", toolCallsTotal: 0 },
      outboundMarkdown: "请使用 read_url",
      flags: [],
      forceSample: true,
    });
    expect(result.passed).toBe(false);
    expect(result.failed).toContain("hygiene");
  });
});
