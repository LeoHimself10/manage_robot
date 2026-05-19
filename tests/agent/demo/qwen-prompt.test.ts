import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt v6.2", () => {
  it("requires unified table via system render and compact draft", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v6.2.1");
    expect(sys).toContain("追问清单第 1 条必须是");
    expect(sys).toContain("禁止只返回 draft");
    expect(sys).not.toContain("先调一次");
    expect(sys).toContain("currentTimeIso");
    expect(sys).toContain("统一宽表");
    expect(sys).toContain("禁止") ;
    expect(sys).toContain("startAt");
    expect(sys).toContain("追问阶段纪律");
    expect(sys).toContain("寒暄与非任务纪律");
  });
});
