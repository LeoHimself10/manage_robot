import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v5.23.8: JSON contract, modes, no PREPARE mode", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.23.8");
    expect(sys).toContain("scheme C");
    expect(sys).toContain("## 输出 JSON 契约");
    expect(sys).not.toContain("§1 ");
    expect(sys).toContain("顶层**必填** `message`");
    expect(sys).toContain("draft`：`{ title, description, tasks[] }`");
    expect(sys).toContain("禁止**在 draft 内使用 demo 字段名");
    expect(sys).toContain("assistantMessage");
    expect(sys).toContain("**无 PREPARE 模式**");
    expect(sys).toContain("CLARIFY");
    expect(sys).toContain("QUERY");
    expect(sys).toContain("DRAFT");
    expect(sys).toContain("ASSIGN");
    expect(sys).toContain("PUBLISH");
    expect(sys).toContain("**REDRAFT");
    expect(sys).toContain("**PATCH REVISE");
    expect(sys).not.toContain("**REVISE**：");
    expect(sys).toContain("prepare_publish_task");
    expect(sys).toContain("须 `publish_task` ok");
    expect(sys).toContain("不是** tool_calls 函数名");
    expect(sys).toContain("同轮直接 DRAFT");
    expect(sys).toContain("纯 DRAFT 禁止");
    expect(sys).toContain("search_similar_plans");
    expect(sys).toContain("update_known_facts");
    expect(sys).toContain("本回合禁止任何 tool_calls");
    expect(sys).toContain("搜人前提");
    expect(sys).toContain("CLARIFY / 纯 DRAFT（无点将）不适用");
    expect(sys).toContain("结构化任务表（列表）");
    expect(sys).toContain("禁止在 message 中重复列出子任务明细");
    expect(sys).toContain("draft.openQuestions");
    expect(sys).toContain("CLARIFY-only");
    expect(sys).toContain("本回合剩余禁止 tool_calls");
    expect(sys).not.toContain("服务端兜底落库");
    expect(sys).toContain("示例2 CLARIFY→DRAFT");
    expect(sys).toContain("示例4 REDRAFT");
    expect(sys).toContain("示例5 ASSIGN");
    expect(sys).toContain("示例6 PUBLISH");
    expect(sys).not.toContain("FOLLOWUP");
    expect(sys).not.toContain("save_draft");
    expect(sys).toContain("**WBS 拆解原则**");
    expect(sys).toContain("勿默认只出少数阶段包");
    expect(sys).toContain("list_managers");
    expect(sys.length).toBeLessThanOrEqual(8200);
  });

  it("v5.23.8: latestDraft judgment order and redraft discipline", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("已有未发布草案");
    expect(sys).toContain("latestDraft");
    expect(sys).toContain("DRAFT 整表重做");
    expect(sys).toContain("tasks[]` 全量替换");
    expect(sys).toContain("PATCH REVISE");
    expect(sys).toContain("拆细/细化/扩条/重新拆解/WBS");
    expect(sys).toContain("禁止**为单点改整表重拆");
    expect(sys).toContain("扩成 7 条/拆更细");
    expect(sys).toContain("整表重出 tasks[]");
  });

  it("v5.23.8: managerFollowup injects FOLLOWUP with continuous step ③", () => {
    const sys = buildQwenPlannerSystemPrompt("planner", { managerFollowup: true });
    expect(sys).toContain("③ 否 → 用户是否要求跟进");
    expect(sys).not.toContain("③ 否 → ④ 否 → 用户是否要求跟进");
    expect(sys).toContain("FOLLOWUP");
    expect(sys).toContain("list_follow_up_candidates");
    expect(sys).toContain("send_subtask_reminder");
    expect(sys).toContain("示例7 FOLLOWUP");
  });

  it("v5.23.8: tools and key disciplines", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("search_employees");
    expect(sys).toContain("resolve_roster_names");
    expect(sys).toContain("按模式选用");
    expect(sys).toContain("update_draft_task");
    expect(sys).toContain("remove_draft_subtask");
    expect(sys).toContain("整表替换");
    expect(sys).toContain("未落库提示");
    expect(sys).toContain("start_new_task");
    expect(sys).toContain("assignment JSON");
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("requires get_task_detail for overall task background questions", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v5.23.8-employee");
    expect(sys).toContain("任务整体背景纪律");
    expect(sys).toContain("get_task_detail");
  });
});

describe("buildQwenPlannerUserPrompt", () => {
  it("embeds sessionDigest before domainHint", () => {
    const user = buildQwenPlannerUserPrompt({
      background: "产线异常",
      domainHint: "QUALITY",
      traceId: "t-1",
      sessionDigest: "## 上轮上下文\n- 上一轮追问：缺批次",
    });
    expect(user).toContain("traceId: t-1");
    expect(user.indexOf("上一轮追问")).toBeLessThan(user.indexOf("domainHint:"));
    expect(user).toContain("domainHint: QUALITY");
    expect(user).toContain("产线异常");
  });
});
