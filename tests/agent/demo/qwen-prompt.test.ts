import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v3.0: ReAct orchestrator prompt with tool descriptions and hard boundaries", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("orchestrator-agent-v3.1");
    expect(sys).toContain("Orchestrator");
    expect(sys).toContain("search_employees");
    expect(sys).toContain("search_web");
    expect(sys).toContain("list_known_facts");
    expect(sys).toContain("update_known_facts");
    expect(sys).toContain("save_draft");
    expect(sys).toContain("stopReason");
    expect(sys).toContain("交付物");
  expect(sys).toContain("deliverables");
  expect(sys).toContain("completionCriteria");
  expect(sys).toContain("反馈频率");
    // v2.11 content should be gone
    expect(sys).not.toContain("responseIntent 只能是");
    expect(sys).not.toContain("CHAT、CLARIFY、DISCUSS、DRAFT");
    expect(sys).not.toContain("clarificationUx");
    expect(sys).not.toContain("NON_TASK");
    expect(sys).not.toContain("TASK_GAP");
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
