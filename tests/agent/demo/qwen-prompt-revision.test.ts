import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

describe("qwen-prompt workbenchDraftRevision", () => {
  it("default planner prompt does not include revision discipline", () => {
    const prompt = buildQwenPlannerSystemPrompt("planner");
    expect(prompt).not.toContain("[WORKBENCH_DRAFT_REVISION]");
    expect(prompt).not.toContain("工作台草案修订");
  });

  it("includes revision block only when workbenchDraftRevision is true", () => {
    const prompt = buildQwenPlannerSystemPrompt("planner", {
      workbenchDraftRevision: true,
    });
    expect(prompt).toContain("工作台草案修订");
    expect(prompt).toContain("禁止 tool_calls");
  });
});
