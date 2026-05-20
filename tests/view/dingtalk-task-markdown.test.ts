import { describe, expect, it, vi } from "vitest";
import {
  hasTaskTableInMessage,
  renderDraftSupplementSection,
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
} from "../../src/view/dingtalk-task-markdown";

describe("hasTaskTableInMessage", () => {
  it("detects unified table header", () => {
    expect(hasTaskTableInMessage("| 负责人 | 协作人 |")).toBe(true);
  });
});

describe("renderDraftSupplementSection", () => {
  it("returns empty (unified table replaces supplement)", () => {
    expect(renderDraftSupplementSection({ tasks: [{ title: "x" }] })).toBe("");
  });
});

describe("renderDingtalkTaskMarkdown", () => {
  const baseDraft = {
    description: "项目背景",
    tasks: [
      {
        id: "task_1",
        title: "检测任务",
        objective: "完成检测",
        deliverables: ["报告"],
        completionCriteria: ["通过"],
        timeNode: { dueAt: "2026-07-01", checkpoints: ["中期"] },
        risksAndOpenQuestions: ["资源不足"],
        feedbackFrequency: "每周",
        inputMaterials: ["样品"],
        actions: ["检测"],
        scope: { inScope: ["A"], outOfScope: ["B"] },
      },
    ],
  };

  const latestAssignment = {
    assignments: [
      { taskId: "task_1", primary: { userId: "u1", displayName: "张三" }, collaborators: ["李四"] },
    ],
  };

  it("renders unified table with assignee from latestAssignment", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("### 任务列表（结构化字段）");
    expect(result).toContain("张三");
    expect(result).toContain("李四");
    expect(result).not.toContain("### 任务补充信息");
    expect(result).toContain("输入材料");
    expect(result).toContain("样品");
  });

  it("shows empty assignee column when no assignment", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("| 检测任务 |");
    expect(result).not.toContain("张三");
  });

  it("assembly order: table BEFORE assignment BEFORE publish", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "消息",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
      assignmentSection: "\n\n分配建议：张三",
      publishResult: {
        ok: true,
        alreadyPublished: false,
        task: { taskNo: "W006", title: "T" },
        subtasks: [{ assigneeUserId: "u1" }],
      },
    });
    const tableIdx = result.indexOf("### 任务列表");
    const assignIdx = result.indexOf("分配建议");
    const publishIdx = result.indexOf("【已发布】");
    expect(tableIdx).toBeLessThan(assignIdx);
    expect(assignIdx).toBeLessThan(publishIdx);
  });
});

describe("appendPublishSummaryMarkdown", () => {
  it("appends fresh publish receipt", () => {
    const result = appendPublishSummaryMarkdown("草案", {
      ok: true,
      alreadyPublished: false,
      task: { taskNo: "W002", title: "品质检查" },
      subtasks: [{ assigneeUserId: "u1" }],
    });
    expect(result).toContain("【已发布】任务编号 W002");
  });
});
