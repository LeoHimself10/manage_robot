import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_POLICY,
  normalizeModelPolicy,
} from "../../../src/agent/demo/model-policy";

describe("normalizeModelPolicy", () => {
  it("clamps unsafe values to sane defaults", () => {
    const policy = normalizeModelPolicy({
      temperature: 2,
      maxTokens: 100000,
      timeoutMs: 100,
      maxRetries: 10,
      requestBudgetTokens: -1,
    });

    expect(policy.temperature).toBe(1);
    expect(policy.maxTokens).toBe(12000);
    expect(policy.timeoutMs).toBe(5000);
    expect(policy.maxRetries).toBe(3);
    expect(policy.requestBudgetTokens).toBe(
      DEFAULT_MODEL_POLICY.requestBudgetTokens
    );
  });
});
