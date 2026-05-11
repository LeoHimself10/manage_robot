import { describe, expect, it } from "vitest";
import { buildQwenPlannerSystemPrompt } from "../../../src/agent/demo/qwen-prompt";

const cases = [
  {
    name: "template rejection",
    input: "不要给我发这个模板了",
    expectedIntent: "DISCUSS or RESET_OR_NEW_TASK",
  },
  {
    name: "new task reset",
    input: "咱们开始一个新任务吧",
    expectedIntent: "RESET_OR_NEW_TASK",
  },
  {
    name: "post draft challenge",
    input: "为什么你把风险排查放在后面？这是不是不合理？",
    expectedIntent: "DISCUSS",
  },
  {
    name: "large detailed decomposition",
    input: "请把一个跨研发、质量、生产的设计变更验证项目细拆到可执行层级",
    expectedIntent: "DRAFT with many tasks when facts sufficient",
  },
];

describe("conversational intent prompt eval fixtures", () => {
  it("documents critical user turns the v3.0 orchestrator prompt must handle", () => {
    const prompt = buildQwenPlannerSystemPrompt();

    for (const item of cases) {
      expect(item.input.length).toBeGreaterThan(0);
      expect(item.expectedIntent.length).toBeGreaterThan(0);
    }
    expect(prompt).toContain("save_draft");
    expect(prompt).toContain("deliverables");
    expect(prompt).toContain("医疗器械");
  });
});
