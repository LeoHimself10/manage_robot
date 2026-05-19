import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt v6.1 planner/manager profile", () => {
  it("contains v6.1 version and key disciplines", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v6.1.0");
    expect(sys).toContain("search_web");
    expect(sys).toContain("主管显式指派纪律");
    expect(sys).toContain("禁止说已发布");
    expect(sys).toContain("首轮必问");
    expect(sys).toContain("期望完成时间/截止日期");
    expect(sys).toContain("历史任务回答纪律");
    expect(sys).toContain("list_managed_tasks");
    expect(sys).toContain("objective");
    expect(sys).toContain("background");
    expect(sys).toContain("timeNode.startAt");
    expect(sys).toContain("dependencyTaskIds");
    expect(sys).toContain("message 瘦身纪律");
    expect(sys).toContain("追问阶段纪律");
    expect(sys).toContain("寒暄与非任务纪律");
    expect(sys).toContain("禁止输出任务表");
  });

  it("requires short greeting and no draft on clarify", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("≤ 80 字");
    expect(sys).toContain("不得**包含 `draft`");
    expect(sys).toContain("omit 整个 draft key");
    expect(sys).not.toContain("质量异常处置");
  });

  it("does not contain legacy fields", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).not.toContain("responseIntent");
    expect(sys).not.toContain("capaAdvisory");
    expect(sys).not.toContain("CLARIFY");
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("employee version uses get_task_detail", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v6.1.0-employee");
    expect(sys).toContain("get_task_detail");
  });
});
