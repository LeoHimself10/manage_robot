import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v2.11：responseIntent 与 assistantMessage，会话意图优先于任务表", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("task-planning-agent-v2.11.0");
    expect(sys).toContain("responseIntent");
    expect(sys).toContain("assistantMessage");
    expect(sys).toContain("CHAT");
    expect(sys).toContain("CLARIFY");
    expect(sys).toContain("DISCUSS");
    expect(sys).toContain("DRAFT");
    expect(sys).toContain("REVISE_DRAFT");
    expect(sys).toContain("RESET_OR_NEW_TASK");
    expect(sys).toContain("只有当 responseIntent 为 DRAFT 或 REVISE_DRAFT");
    expect(sys).toContain("不要把 openQuestions 当作自然回复的唯一出口");
    expect(sys).toContain("10–20");
    expect(sys).toContain("JSON");
    expect(sys).not.toContain("其中须有一条以「**本机器人**」为主语");
    expect(sys).not.toContain("请「您」用**一段**完整、可拆解的任务背景描述重新发送");
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
    expect(user).toContain("responseIntent");
  });
});
