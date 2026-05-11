import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v4.1: first-round-question, second-round-draft prompt", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v5.5");
    expect(sys).toContain("save_draft");
    expect(sys).toContain("list_known_facts");
    expect(sys).toContain("deliverables");
    expect(sys).toContain("待确认");
    expect(sys).toContain("医疗器械");
    expect(sys).toContain("开启新话题");
    expect(sys).not.toContain("responseIntent");
    expect(sys).not.toContain("CLARIFY");
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
