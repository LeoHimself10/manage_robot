import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v4.1: first-round-question, second-round-draft prompt", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.12");
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
    // v5.12：含 description / 员工详情工具指引 / pendingRoster+latestDraft 纪律；阈值仅防 bloat。
    expect(sys.length).toBeLessThanOrEqual(6200);
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
