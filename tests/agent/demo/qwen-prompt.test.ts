import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v4.1: first-round-question, second-round-draft prompt", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.8");
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
    // v5.8 + 主管上传花名册纪律段（candidate-pool 工具族）后基线约 4500 字符。
    // 阈值是反 bloat 的安全兜底，不强求绝对值。
    expect(sys.length).toBeLessThanOrEqual(4600);
    expect(sys).toContain("read_uploaded_roster_text");
    expect(sys).toContain("set_candidate_pool");
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
