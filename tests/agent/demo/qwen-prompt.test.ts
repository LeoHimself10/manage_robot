import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v2.8：允许多句任务背景、禁止关于您的问题套话、本机器人+您", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("task-planning-agent-v2.8");
    expect(sys).toContain("寒暄");
    expect(sys).toContain("钉钉");
    expect(sys).toContain("clarificationUx");
    expect(sys).toContain("NON_TASK");
    expect(sys).toContain("TASK_GAP");
    expect(sys).toContain("本机器人");
    expect(sys).toContain("您");
    expect(sys).toContain("允许多句");
    expect(sys).toContain("关于你的问题");
    expect(sys).toContain("你是机器人");
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
    expect(user).toContain("openQuestions");
  });
});
