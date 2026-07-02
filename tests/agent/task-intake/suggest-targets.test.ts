import { afterEach, describe, expect, it } from "vitest";
import { suggestTaskTargets } from "../../../src/agent/task-intake/suggest-targets";
import { __setTaskIntakeLlmForTest } from "../../../src/agent/task-intake/task-intake-llm";

afterEach(() => {
  __setTaskIntakeLlmForTest(undefined);
});

describe("task-intake suggest-targets", () => {
  it("guides meeting-derived action items toward existing related tasks instead of generic follow-up groups", async () => {
    let seenSystem = "";
    let seenUser = "";
    __setTaskIntakeLlmForTest(async (input) => {
      seenSystem = input.system;
      seenUser = input.user;
      return JSON.stringify([
        {
          itemId: "ti_1",
          targetPlanId: "plan-log",
          newGroupId: null,
          newGroupTitle: null,
          newGroupDescription: null,
          confidence: 0.82,
          reason: "对应已有项目",
        },
      ]);
    });

    const suggestions = await suggestTaskTargets({
      sourceKind: "meeting_transcript",
      sourceTitle: "AI 日志助手需求收集",
      subtasks: [
        {
          itemId: "ti_1",
          title: "整理 AI 日志助手用户需求",
          objective: "沉淀会议中确认的需求点",
        },
      ],
      existingTasks: [{ planId: "plan-log", taskNo: "T-1", title: "AI 日志助手" }],
    });

    expect(seenSystem).toContain("会议纪要或会议原文转写");
    expect(seenSystem).toContain("优先追加到语义明确相关的已有父任务");
    expect(seenSystem).toContain("不要因为来源是会议就新建泛泛的会议跟进组");
    expect(seenUser).toContain("来源：会议原文转写");
    expect(seenUser).toContain("AI 日志助手需求收集");
    expect(suggestions[0]).toMatchObject({ targetPlanId: "plan-log", confidence: 0.82 });
  });
});
