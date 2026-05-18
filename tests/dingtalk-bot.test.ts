import { describe, expect, it } from "vitest";
import {
  appendPublishSummaryMarkdown,
  renderDraftSupplementSection,
  shouldUseAnonymousSession,
} from "../src/dingtalk-bot";
import { buildToolRegistry } from "../src/agent/tools/registry";

describe("dingtalk bot helpers", () => {
  it("uses anonymous session when senderStaffId is empty", () => {
    expect(shouldUseAnonymousSession("")).toBe(true);
    expect(shouldUseAnonymousSession("   ")).toBe(true);
    expect(shouldUseAnonymousSession("manager-1")).toBe(false);
  });

  it("appends publish summary for fresh publish", () => {
    const output = appendPublishSummaryMarkdown("草案已准备", {
      ok: true,
      alreadyPublished: false,
      task: { taskNo: "W20260513001", title: "测试任务" },
      subtasks: [
        { assigneeUserId: "emp-1", title: "A" },
        { assigneeUserId: "emp-2", title: "B" },
      ],
      warnings: [],
    });
    expect(output).toContain("【已发布】任务编号 W20260513001");
    expect(output).toContain("子任务 2 个 → 已通知 2 名员工");
  });

  it("appends already published summary when publish is duplicated", () => {
    const output = appendPublishSummaryMarkdown("草案已准备", {
      ok: true,
      alreadyPublished: true,
      task: { taskNo: "W20260513001", title: "测试任务" },
    });
    expect(output).toContain("此计划已发布过");
    expect(output).toContain("W20260513001");
  });

  it("known facts store can be updated through registry tools", async () => {
    let facts: string[] = ["旧事实"];
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      knownFactsStore: {
        get: () => facts,
        update: (next) => {
          facts = [...new Set([...facts, ...next])];
        },
      },
    });
    await registry.update_known_facts.handler({ facts: ["新事实"] });
    expect(facts).toContain("新事实");
  });

  it("renders deterministic structured draft preview with rich fields", () => {
    const markdown = renderDraftSupplementSection({
      description: "任务整体背景",
      tasks: [
        {
          id: "task_1",
          title: "任务A",
          objective: "目标A",
          deliverables: ["交付A"],
          completionCriteria: ["标准A"],
          feedbackFrequency: "每日",
          dependencyTaskIds: ["task_0"],
          timeNode: { dueAt: "2026-06-01", checkpoints: ["里程碑1"] },
          risksAndOpenQuestions: ["风险A"],
          inputMaterials: ["输入A"],
          actions: ["动作A"],
          collaborators: ["协作A"],
          scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
        },
      ],
    });
    expect(markdown).toContain("### 任务草案（结构化字段）");
    expect(markdown).toContain("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |");
    expect(markdown).toContain("任务背景");
    expect(markdown).toContain("输入材料");
    expect(markdown).toContain("执行动作");
    expect(markdown).toContain("协作人");
    expect(markdown).toContain("范围内");
    expect(markdown).toContain("范围外");
    expect(markdown).toContain("前置依赖");
    expect(markdown).toContain("检查点");
    expect(markdown).toContain("风险与待澄清");
  });
});
