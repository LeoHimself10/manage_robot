import { describe, expect, it } from "vitest";
import {
  hasTaskTableInMessage,
  renderDraftSupplementSection,
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
  stripBrokenInlineTaskTable,
} from "../../src/view/dingtalk-task-markdown";

describe("hasTaskTableInMessage", () => {
  it("detects structured task list section header", () => {
    expect(hasTaskTableInMessage("### 结构化任务表（列表）")).toBe(true);
    expect(hasTaskTableInMessage("### 任务列表（结构化字段）")).toBe(true);
  });

  it("does not treat inline pipe table as server-rendered section", () => {
    expect(hasTaskTableInMessage("| # | 任务 | 目标 | 截止 | 负责人 | 反馈频率 |")).toBe(false);
  });

  it("detects supplement section header", () => {
    expect(hasTaskTableInMessage("### 任务补充信息")).toBe(true);
  });
});

describe("stripBrokenInlineTaskTable", () => {
  it("removes single-line pipe table blobs", () => {
    const broken =
      "说明文字\n| # | 任务 | 目标 | 截止 | | 1 | A | B | 2026-05-01 |";
    expect(stripBrokenInlineTaskTable(broken)).toBe("说明文字");
  });
});

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

describe("renderDraftSupplementSection", () => {
  it("renders per-task rich-field cards", () => {
    const out = renderDraftSupplementSection(baseDraft, latestAssignment);
    expect(out).toContain("### 任务补充信息");
    expect(out).toContain("[#1] 检测任务");
    expect(out).toContain("负责人：张三");
    expect(out).toContain("- 交付物：报告");
    expect(out).toContain("- 执行动作：检测");
  });
});

describe("renderDingtalkTaskMarkdown", () => {
  it("renders list overview + supplement cards (no pipe table)", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("### 结构化任务表（列表）");
    expect(result).toContain("1. 检测任务");
    expect(result).toContain("目标：完成检测");
    expect(result).toContain("负责人：张三");
    expect(result).toContain("### 任务补充信息");
    expect(result).not.toMatch(/\| # \| 任务 \|/);
  });

  it("strips model inline table and appends list section", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "| # | 任务 | 目标 | 截止 | | 1 | X | Y | Z |",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("1. 检测任务");
    expect(result).not.toMatch(/\| # \| 任务 \|/);
  });

  it("shows no assignee line when no assignment", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("1. 检测任务");
    expect(result).not.toContain("负责人：张三");
  });

  it("assembly order: list BEFORE assignment BEFORE publish", () => {
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
    const listIdx = result.indexOf("### 结构化任务表");
    const supplementIdx = result.indexOf("### 任务补充信息");
    const assignIdx = result.indexOf("分配建议");
    const publishIdx = result.indexOf("【已发布】");
    expect(listIdx).toBeLessThan(supplementIdx);
    expect(supplementIdx).toBeLessThan(assignIdx);
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
