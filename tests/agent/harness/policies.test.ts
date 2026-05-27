import { describe, expect, it } from "vitest";
import { validateDispatchGate } from "../../../src/agent/harness/policies";
import { minimalQualityTask } from "../demo/llm-fixtures";

describe("validateDispatchGate", () => {
  it("uses the same non-empty required field rules as the demo gate", () => {
    const result = validateDispatchGate(
      { allowWaiver: false },
      {
        taskPackage: minimalQualityTask({
          deliverables: ["   "],
          completionCriteria: [],
          timeNode: { checkpoints: [], dueAt: " " },
          feedbackFrequency: "",
        }),
      }
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toContain("deliverables");
    expect(result.reason).toContain("completionCriteria");
    expect(result.reason).toContain("timeNode.dueAt");
    expect(result.reason).not.toContain("feedbackFrequency");
  });
});
