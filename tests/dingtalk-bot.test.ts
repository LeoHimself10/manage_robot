import { describe, expect, it } from "vitest";
import {
  appendPublishSummaryMarkdown,
  appendUnifiedDraftTableToOutbound,
  renderDraftSupplementSection,
  shouldUseAnonymousSession,
} from "../src/dingtalk-bot";
import { looksLikeTaskDraftMessage } from "../src/agent/demo/draft-fallback-extract";
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
      title: "OCT U盘稳定性排查",
      objective: "任务整体目标",
      background: "任务整体背景",
      tasks: [
        {
          id: "task_1",
          title: "任务A",
          objective: "目标A",
          deliverables: ["交付A"],
          completionCriteria: ["标准A"],
          feedbackFrequency: "每日",
          dependencyTaskIds: ["task_0"],
          timeNode: { startAt: "2026-05-20", dueAt: "2026-06-01", checkpoints: ["里程碑1"] },
          risksAndOpenQuestions: ["风险A"],
          inputMaterials: ["输入A"],
          actions: ["动作A"],
          collaborators: ["协作A"],
          scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
        },
      ],
    });
    expect(markdown).toContain("### 任务草案");
    expect(markdown).toContain("| # | 任务 | 负责人 | 开始 | 截止 | 依赖 | 目标 | 交付物 | 完成标准 | 输入材料 | 执行动作 | 协作人 | 范围内 | 范围外 | 风险 |");
    expect(markdown).toContain("任务目标");
    expect(markdown).toContain("触发背景");
    expect(markdown).toContain("输入A");
    expect(markdown).toContain("协作A");
    expect(markdown).toContain("范围内A");
    expect(markdown).not.toContain("### 任务补充信息");
    expect(markdown).not.toContain("- 输入材料：");
  });

  it("renders assignment summary table when assigneeUserId is set", () => {
    const markdown = renderDraftSupplementSection({
      title: "OCT 导管改进",
      objective: "目标",
      background: "背景",
      tasks: [
        {
          id: "t1",
          title: "子任务A",
          assigneeUserId: "u1",
          assigneeDisplayName: "杨楚榛",
          objective: "o1",
          deliverables: [],
          completionCriteria: [],
          dependencyTaskIds: [],
          timeNode: { startAt: "2026-05-19", dueAt: "2026-05-21", checkpoints: [] },
          risksAndOpenQuestions: [],
          inputMaterials: [],
          actions: [],
          collaborators: [],
          scope: { inScope: [], outOfScope: [] },
        },
      ],
    });
    expect(markdown).toContain("### 分配结果（简表）");
    expect(markdown).toContain("| # | 任务 | 负责人 | 开始 | 截止 | 依赖 |");
    expect(markdown).toContain("杨楚榛");
    expect(markdown).toContain("### 任务详情（宽表）");
  });

  it("appendUnifiedDraftTableToOutbound appends wide table for session draft", () => {
    const out = appendUnifiedDraftTableToOutbound(
      "已将负责人调整为杨贺新，请确认是否发布？",
      {
        title: "OCT 1210",
        objective: "目标",
        background: "背景",
        tasks: [
          {
            id: "t1",
            title: "子任务A",
            assigneeUserId: "u1",
            assigneeDisplayName: "杨贺新",
            objective: "o1",
            deliverables: ["d1"],
            completionCriteria: ["c1"],
            dependencyTaskIds: [],
            timeNode: { startAt: "2026-05-19", dueAt: "2026-05-21", checkpoints: [] },
            risksAndOpenQuestions: [],
            inputMaterials: [],
            actions: [],
            collaborators: [],
            scope: { inScope: [], outOfScope: [] },
          },
        ],
      },
      () => "杨贺新",
    );
    expect(out).toContain("### 分配结果（简表）");
    expect(out).toContain("杨贺新");
  });

  it("looksLikeTaskDraftMessage matches multi-signal markdown", () => {
    const md = [
      "以下是任务草案。",
      "",
      "| ID | 子任务标题 | 负责人 |",
      "| --- | --- | --- |",
      "| task_1 | A | 张三 |",
      "| task_2 | B | 李四 |",
      "",
      "**说明**：请确认。",
      "",
      "更多上下文行。",
      "再一行。",
      "再一行。",
    ].join("\n");
    expect(looksLikeTaskDraftMessage(md)).toBe(true);
  });
});
