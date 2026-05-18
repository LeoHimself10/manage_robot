import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt v6 planner/manager profile", () => {
  it("contains v6 version and key disciplines", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v6.0.0");
    expect(sys).toContain("search_web");
    expect(sys).toContain("医疗器械");
    expect(sys).toContain("主管显式指派纪律");
    expect(sys).toContain("主题切换纪律");
    expect(sys).toContain("publish 前 readback");
    expect(sys).toContain("userId 不入主消息");
    expect(sys).toContain("start_new_task");
    expect(sys).toContain("update_draft_task");
    expect(sys).toContain("禁止说已发布");
    expect(sys).toContain("首轮必问截止");
    expect(sys).toContain("期望完成时间/截止日期");
    expect(sys).toContain("确认发布");
    expect(sys).toContain("否定/暂停词");
    expect(sys).toContain("候选池内");
    expect(sys).toContain("历史任务回答纪律");
    expect(sys).toContain("list_managed_tasks");
    // v6 新必填字段
    expect(sys).toContain("objective");
    expect(sys).toContain("background");
    expect(sys).toContain("dependencyTaskIds");
    expect(sys).toContain("risksAndOpenQuestions");
    expect(sys).toContain("inputMaterials");
    expect(sys).toContain("actions");
    expect(sys).toContain("collaborators");
    expect(sys).toContain("scope.inScope");
    expect(sys).toContain("scope.outOfScope");
    expect(sys).toContain("draft 落盘纪律");
  });

  it("does not contain legacy fields", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).not.toContain("responseIntent");
    expect(sys).not.toContain("classification");
    expect(sys).not.toContain("capaAdvisory");
    expect(sys).not.toContain("CLARIFY");
    // v6 顶层不再用 description，用 objective + background
    expect(sys).not.toContain("draft 顶层必须含 `description`");
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("employee version uses get_task_detail and task background discipline", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v6.0.0-employee");
    expect(sys).toContain("任务整体背景纪律");
    expect(sys).toContain("get_task_detail");
  });
});
