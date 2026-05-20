import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v5.23.1: JSON contract, modes, no PREPARE mode", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.23.1");
    expect(sys).toContain("请生成草案");
    expect(sys).toContain("禁止**写「我将为您生成正式草案");
    expect(sys).toContain("## 输出 JSON 契约");
    expect(sys).not.toContain("§1 ");
    expect(sys).toContain("顶层**必填** `message`");
    expect(sys).toContain("draft`：`{ title, description, tasks[] }`");
    expect(sys).toContain("禁止**在 draft 内使用 demo 字段名");
    expect(sys).toContain("assistantMessage");
    expect(sys).toContain("**无 PREPARE 模式**");
    expect(sys).not.toMatch(/message 仅 1[–-]3 句/);
    expect(sys).not.toContain("message 仅 1–3 句");
    expect(sys).toContain("CLARIFY");
    expect(sys).toContain("QUERY");
    expect(sys).toContain("DRAFT");
    expect(sys).toContain("ASSIGN");
    expect(sys).toContain("PUBLISH");
    expect(sys).toContain("**REVISE**");
    expect(sys).toContain("prepare_publish_task");
    expect(sys).toContain("须 `publish_task` ok");
    expect(sys).toContain("不是** tool_calls 函数名");
    expect(sys).toContain("同轮直接 DRAFT");
    expect(sys).toContain("tool_calls 调用 CLARIFY/DRAFT/QUERY 等模式名");
    expect(sys).not.toContain("服务端兜底落库");
    expect(sys).toContain("示例2 CLARIFY→DRAFT");
    expect(sys).toContain("示例5 PUBLISH");
    expect(sys).not.toContain("发布纪律");
    expect(sys).not.toContain("示例4 prepare");
    expect(sys).not.toContain("尚未正式发布");
    expect(sys).not.toContain("禁止说已发布");
    const toolCheatsheet = sys.split("## 工具速查")[1] ?? "";
    expect(toolCheatsheet).not.toContain("admin_list_all_tasks");
    expect(toolCheatsheet).not.toContain("list_my_tasks");
    expect(sys).not.toContain("③ 否 → ④ 否 →");
    expect(sys).toContain("寒暄/打招呼");
    expect(sys).not.toContain("FOLLOWUP");
    expect(sys).not.toContain("save_draft");
    expect((sys.match(/手画/g) ?? []).length).toBe(1);
    expect((sys.match(/PUBLISH/g) ?? []).length).toBeLessThanOrEqual(6);
    expect(sys.length).toBeLessThanOrEqual(5500);
  });

  it("v5.23.1: managerFollowup injects FOLLOWUP with continuous step ③", () => {
    const sys = buildQwenPlannerSystemPrompt("planner", { managerFollowup: true });
    expect(sys).toContain("③ 否 → 用户是否要求跟进");
    expect(sys).not.toContain("③ 否 → ④ 否 → 用户是否要求跟进");
    expect(sys).toContain("FOLLOWUP");
    expect(sys).toContain("list_follow_up_candidates");
    expect(sys).toContain("send_subtask_reminder");
    expect(sys).toContain("示例6 FOLLOWUP");
  });

  it("v5.23.1: tools and key disciplines", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("search_employees");
    expect(sys).toContain("update_draft_task");
    expect(sys).toContain("整表替换");
    expect(sys).toContain("服务端会重试");
    expect(sys).toContain("start_new_task");
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("requires get_task_detail for overall task background questions", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v5.23.1-employee");
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
