import { describe, expect, it } from "vitest";
import {
  sanitizeToolNameLeak,
  shouldUseAnonymousSession,
} from "../src/dingtalk-bot";
import {
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
} from "../src/view/dingtalk-task-markdown";
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

  it("known facts store can be updated through registry tools when draft exists", async () => {
    let facts: string[] = ["旧事实"];
    const registry = buildToolRegistry({
      employeeRepo: { list: () => [] },
      toolProfile: "planner",
      currentSession: {
        latestDraft: { tasks: [{ id: "task_1", title: "测试" }] },
      } as import("../../src/infra/plan-session-store").PlanSession,
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

  it("replaces bare tool-name replies before sending to DingTalk", () => {
    expect(sanitizeToolNameLeak("release_task").markdown).toBe("release_task");
    expect(sanitizeToolNameLeak("list_managed_tasks")).toMatchObject({
      leaked: true,
      markdown: "（系统检测到模型输出异常，已忽略；请重新描述您的需求。）",
    });
    expect(sanitizeToolNameLeak("请调用 list_managed_tasks")).toMatchObject({
      leaked: false,
      markdown: "请调用 list_managed_tasks",
    });
  });

  it("renders core and more-planning pipe tables with rich fields", () => {
    const markdown = renderDingtalkTaskMarkdown({
      modelMessage: "草案说明",
      currentDraft: {
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
            scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
          },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { displayName: "协作A" }, collaborators: ["李四"] },
        ],
      },
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(markdown).toContain("### 结构化任务表");
    expect(markdown).toMatch(/\| # \| 任务 \| 目标 \| 交付物 \| 完成标准 \| 截止 \| 执行动作 \| 前置依赖 \| 负责人 \|/);
    expect(markdown).toContain("| 1 | 任务A | 目标A | 交付A | 标准A | 2026-06-01 | 动作A | task_0 | 协作A |");
    expect(markdown).toContain("### 更多规划（7 项）");
    expect(markdown).toContain("任务背景");
    expect(markdown).toContain("输入A");
    expect(markdown).toContain("动作A");
    expect(markdown).toContain("协作A");
    expect(markdown).toContain("李四");
    expect(markdown).toContain("范围内A");
    expect(markdown).toContain("范围外A");
    expect(markdown).toContain("里程碑1");
    expect(markdown).toContain("风险A");
  });
});
