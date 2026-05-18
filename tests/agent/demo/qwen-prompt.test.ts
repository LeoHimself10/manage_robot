import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v5.17: publish/draft/candidate-pool + history discipline prompt", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.17.0");
    expect(sys).toContain("search_web");
    expect(sys).toContain("deliverables");
    expect(sys).toContain("待确认");
    expect(sys).toContain("医疗器械");
    expect(sys).toContain("新话题");
    expect(sys).toContain("待确认");
    expect(sys).toContain("必须成对闭合");
    expect(sys).not.toContain("responseIntent");
    expect(sys).not.toContain("CLARIFY");
    expect(sys).toContain("主管显式指派纪律");
    expect(sys).toContain("主题切换纪律");
    expect(sys).toContain("publish 前 readback");
    expect(sys).toContain("userId 不入主消息");
    expect(sys).toContain("start_new_task");
    expect(sys).toContain("switch_back_task");
    expect(sys).toContain("update_draft_task");
    expect(sys).toContain("不设固定上限");
    expect(sys).toContain("钉钉 publish_task 成功后");
    expect(sys).toContain("dependencyTaskIds");
    expect(sys).toContain("checkpoints");
    expect(sys).toContain("draft 顶层必须含 `description`");
    expect(sys).toContain("严禁反问用户");
    expect(sys).toContain("inputMaterials");
    expect(sys).toContain("update_draft_task 纪律");
    expect(sys).toContain("整表替换");
    // v5.17：历史任务工具化 + 主题切换后 history 锚点说明。
    expect(sys).toContain("禁止说已发布");
    expect(sys).toContain("已归档");
    expect(sys).toContain("start_new_task` ok=true");
    expect(sys).toContain("会污染下一轮上下文");
    expect(sys).toContain("首轮必问截止");
    expect(sys).toContain("期望完成时间/截止日期");
    expect(sys).toContain("确认发布");
    expect(sys).toContain("否定/暂停词");
    expect(sys).toContain("等等");
    expect(sys).toContain("候选池内");
    expect(sys).toContain("禁止报「未找到」");
    expect(sys).toContain("JSON 顶层 draft");
    expect(sys.length).toBeLessThanOrEqual(9200);
    expect(sys).toContain("历史任务回答纪律");
    expect(sys).toContain("list_managed_tasks");
    expect(sys).toContain("[memory_context]");
  });
});

describe("buildQwenPlannerSystemPrompt employee profile", () => {
  it("requires get_task_detail for overall task background questions", () => {
    const sys = buildQwenPlannerSystemPrompt("employee");
    expect(sys).toContain("orchestrator-agent-v5.17.0-employee");
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
