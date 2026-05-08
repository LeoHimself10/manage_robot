import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v2.7：NON_TASK/TASK_GAP、本机器人主语与用户敬称您、渠道不拼接套话", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("task-planning-agent-v2.7");
    expect(sys).toContain("寒暄");
    expect(sys).toContain("钉钉");
    expect(sys).toContain("clarificationUx");
    expect(sys).toContain("NON_TASK");
    expect(sys).toContain("TASK_GAP");
    expect(sys).toContain("本机器人");
    expect(sys).toContain("您");
    expect(sys).toContain("不会");
    expect(sys).toContain("自动");
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
