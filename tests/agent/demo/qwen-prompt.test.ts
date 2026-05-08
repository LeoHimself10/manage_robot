import { describe, expect, it } from "vitest";
import {
  buildQwenPlannerSystemPrompt,
  buildQwenPlannerUserPrompt,
} from "../../../src/agent/demo/qwen-prompt";

describe("buildQwenPlannerSystemPrompt", () => {
  it("v2.10：多轮质疑先自然回应，任务数量按复杂度展开", () => {
    const sys = buildQwenPlannerSystemPrompt();
    expect(sys).toContain("task-planning-agent-v2.10");
    expect(sys).toContain("质疑");
    expect(sys).toContain("先解释");
    expect(sys).toContain("不必每次重生成任务表");
    expect(sys).toContain("复杂度");
    expect(sys).toContain("几十个");
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
    expect(user).toContain("openQuestions");
  });
});
