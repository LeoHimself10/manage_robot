import { describe, expect, it } from "vitest";
import {
  collectGateSelfCheckAlignmentWarnings,
  collectTaskConsistencyWarnings,
} from "../../../src/agent/demo/consistency";
import { validateDemoGate } from "../../../src/agent/demo/gate";
import { minimalQualityTask } from "./llm-fixtures";

describe("collectTaskConsistencyWarnings", () => {
  it("warns on unknown dependency id", () => {
    const w = collectTaskConsistencyWarnings([
      minimalQualityTask({ id: "a", dependencyTaskIds: ["missing"] }),
    ]);
    expect(w.some((s) => s.includes("未知的依赖"))).toBe(true);
  });

  it("warns on cycle", () => {
    const w = collectTaskConsistencyWarnings([
      minimalQualityTask({
        id: "a",
        dependencyTaskIds: ["b"],
        timeNode: { checkpoints: [], dueAt: "2026-05-02" },
      }),
      minimalQualityTask({
        id: "b",
        dependencyTaskIds: ["a"],
        timeNode: { checkpoints: [], dueAt: "2026-05-03" },
      }),
    ]);
    expect(w.some((s) => s.includes("循环依赖"))).toBe(true);
  });
});

describe("collectGateSelfCheckAlignmentWarnings", () => {
  it("reports overlapping missing fields between self-check and gate", () => {
    const gate = validateDemoGate([
      minimalQualityTask({
        id: "t1",
        deliverables: [],
        completionCriteria: [],
        timeNode: { checkpoints: [], dueAt: "" },
        feedbackFrequency: "",
      }),
    ]);
    expect(gate.passed).toBe(false);
    const w = collectGateSelfCheckAlignmentWarnings(
      {
        passed: false,
        missingByTask: [
          { taskId: "t1", title: "", missingFields: ["deliverables"] },
        ],
      },
      gate
    );
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w[0]).toContain("gateSelfCheck");
  });
});
