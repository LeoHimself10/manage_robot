import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt v6.3.5", () => {
  it("contains version header and four-phase structure including query phase D", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v6.3.5");
    expect(sys).toContain("阶段 D · 查询与进展");
    expect(sys).toContain("阶段 A · 追问");
    expect(sys).toContain("阶段 B · 出草案");
    expect(sys).toContain("阶段 C · 调整与发布");
    expect(sys).toMatch(/阶段D\(查询\).*阶段A/);
  });

  it("enforces phase D query discipline", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("list_managed_tasks");
    expect(sys).toContain("get_task_detail");
    expect(sys).toContain("不含 draft");
    expect(sys).toContain("禁止") ;
    expect(sys).toMatch(/latestDraft.*禁止|禁止.*latestDraft/);
    expect(sys).toContain("taskId");
    expect(sys).toMatch(/禁止.*索要内部/);
  });

  it("enforces phase A discipline: ask deadline first, no search tools", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("第 1 条必问");
    expect(sys).toContain("期望完成时间");
    expect(sys).toMatch(/禁止工具：search_employees、get_employee_details、prepare_publish_task/);
  });

  it("forbids search_employees in phase B (draft generation)", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("禁止搜人");
    expect(sys).toContain("先出草案再分配");
    expect(sys).toContain("阶段 B 一律空串");
  });

  it("requires mandatory draft JSON and forbids 子任务 blocks in phase B message", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("draft.tasks.length >= 1");
    expect(sys).toMatch(/禁止.*子任务/);
    expect(sys).toMatch(/start_new_task/);
    expect(sys).toMatch(/candidatePool|花名册/);
  });

  it("describes phase C sub-flows (C-1 微调 / C-2 分配 / C-3 发布)", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("C-1");
    expect(sys).toContain("C-2");
    expect(sys).toContain("C-3");
    expect(sys).toContain("合计 ≤ 2 次");
    expect(sys).toContain("prepare_publish_task");
    expect(sys).toContain("禁止") ;
    expect(sys).toMatch(/禁止.*message.*交付物|禁止.*逐条展开/);
    expect(sys).toContain("负责人列");
  });

  it("requires non-empty message and discards top-level assignment", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("message **始终非空**");
    expect(sys).toContain("assignment **已弃用**");
    expect(sys).toContain("tasks[].assigneeUserId");
  });

  it("references currentTimeIso for scheduling and forbids 待确认", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("currentTimeIso");
    expect(sys).toContain("禁止给 startAt / dueAt 写「待确认」");
  });

  it("drops the legacy <=25 char limit (encourages detail)", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).not.toContain("每条 ≤25 字");
    expect(sys).toContain("尽量详细");
  });

  it("instructs immediate stop after tool quota_exhausted", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("quota_exhausted");
    expect(sys).toMatch(/禁止重试同名工具/);
  });
});
