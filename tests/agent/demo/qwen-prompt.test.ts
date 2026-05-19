import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v5.20: five modes by default, six with managerFollowup", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.20");
    expect(sys).toContain("医疗器械");
    expect(sys).toContain("OCT");
    expect(sys).toContain("本轮操作模式");
    expect(sys).toContain("CLARIFY");
    expect(sys).toContain("QUERY");
    expect(sys).toContain("DRAFT");
    expect(sys).toContain("ASSIGN");
    expect(sys).toContain("PUBLISH");
    expect(sys).toContain("QUERY 模式纪律");
    expect(sys).toContain("服务端根据 draft 自动渲染");
    expect(sys).toContain("在 message 中自行输出");
    expect(sys).not.toContain("摘要表");
    expect(sys).not.toContain("message 可附");
    expect(sys).toContain("可在同句叠加");
    expect(sys).toContain("核心红线");
    expect(sys).toContain("行为示例");
    expect(sys).not.toContain("responseIntent");
    expect(sys).not.toContain("save_draft");
    expect(sys).toContain("禁止说已发布");
    expect(sys).toContain("会污染下一轮上下文");
    expect(sys).toContain("start_new_task` ok=true");
    expect(sys).toContain("JSON 顶层 draft");
    expect(sys).toContain("用户已给出明确截止日期");
    expect(sys).toContain("期望完成时间/截止日期");
    expect(sys).toContain("确认发布");
    expect(sys).toContain("否定/暂停词");
    expect(sys).toContain("等等");
    expect(sys).toContain("候选池内");
    expect(sys).toContain("禁止报「未找到」");
    expect(sys).toContain("主管显式指派纪律");
    expect(sys).toContain("主题切换纪律");
    expect(sys).toContain("publish 前 readback");
    expect(sys).toContain("update_draft_task 纪律");
    expect(sys).toContain("整表替换");
    expect(sys).toContain("主管上传花名册纪律");
    expect(sys).toContain("严禁反问用户");
    expect(sys).toContain("userId 不入主消息");
    expect(sys).toContain("[system_note]");
    expect(sys).toContain("钉钉 publish_task 成功后");
    expect(sys).toContain("示例 7");
    expect(sys).toContain("list_managed_tasks");
    expect(sys).not.toContain("FOLLOWUP");
    expect(sys).not.toContain("list_follow_up_candidates");
  });
  it("v5.20: managerFollowup injects sixth mode and tools", () => {
    const sys = buildQwenPlannerSystemPrompt("planner", { managerFollowup: true });
    expect(sys).toContain("FOLLOWUP");
    expect(sys).toContain("list_follow_up_candidates");
    expect(sys).toContain("send_subtask_reminder");
    expect(sys).toContain("示例 8");
  });
  it("v5.20: tools, fields, and length cap", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("search_web");
    expect(sys).toContain("update_known_facts");
    expect(sys).toContain("list_known_facts");
    expect(sys).toContain("read_uploaded_roster_text");
    expect(sys).toContain("set_candidate_pool");
    expect(sys).toContain("list_candidate_pool");
    expect(sys).toContain("deliverables");
    expect(sys).toContain("dependencyTaskIds");
    expect(sys).toContain("checkpoints");
    expect(sys).toContain("inputMaterials");
    expect(sys).toContain("待确认");
    expect(sys).toContain("新话题");
    expect(sys).toContain("必须成对闭合");
    expect(sys).toContain("不设固定上限");
    expect(sys).toContain("start_new_task");
    expect(sys).toContain("switch_back_task");
    expect(sys).toContain("update_draft_task");
    expect(sys.length).toBeLessThanOrEqual(8000);
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("requires get_task_detail for overall task background questions", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v5.20-employee");
    expect(sys).toContain("医疗器械");
    expect(sys).toContain("OCT");
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
