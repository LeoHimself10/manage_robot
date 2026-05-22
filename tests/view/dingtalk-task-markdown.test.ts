import { describe, expect, it } from "vitest";
import {
  hasTaskTableInMessage,
  renderDraftSupplementSection,
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
  stripBrokenInlineTaskTable,
} from "../../src/view/dingtalk-task-markdown";

describe("hasTaskTableInMessage", () => {
  it("detects structured task table section header", () => {
    expect(hasTaskTableInMessage("### 结构化任务表")).toBe(true);
    expect(hasTaskTableInMessage("### 结构化任务表（列表）")).toBe(true);
    expect(hasTaskTableInMessage("### 任务列表（结构化字段）")).toBe(true);
    expect(hasTaskTableInMessage("### 更多规划（7 项）")).toBe(true);
  });

  it("does not treat inline pipe table alone as server-rendered section", () => {
    expect(hasTaskTableInMessage("| # | 任务 | 目标 | 截止 | 负责人 | 反馈频率 |")).toBe(false);
  });

  it("detects legacy supplement section header", () => {
    expect(hasTaskTableInMessage("### 任务补充信息")).toBe(true);
  });
});

describe("stripBrokenInlineTaskTable", () => {
  it("removes single-line pipe table blobs", () => {
    const broken =
      "说明文字\n| # | 任务 | 目标 | 截止 | | 1 | A | B | 2026-05-01 |";
    expect(stripBrokenInlineTaskTable(broken)).toBe("说明文字");
  });

  it("does not remove multi-line server-rendered pipe tables in model message", () => {
    const multi =
      "### 结构化任务表\n| # | 任务 | 目标 |\n| --- | --- | --- |\n| 1 | A | B |";
    expect(stripBrokenInlineTaskTable(multi)).toBe(multi);
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
  it("renders more-planning pipe table", () => {
    const out = renderDraftSupplementSection(baseDraft, latestAssignment);
    expect(out).toContain("### 更多规划（7 项）");
    expect(out).toContain("| # | 反馈频率 | 输入材料 | 协作人 | 范围内 | 范围外 | 检查点 | 风险 |");
    expect(out).toContain("| 1 | 每周 | 样品 | 李四 | A | B | 中期 | 资源不足 |");
    expect(out).not.toContain("### 任务补充信息");
  });

  it("omits table when all more-planning fields empty", () => {
    const sparse = {
      tasks: [{ id: "task_1", title: "T", objective: "O" }],
    };
    expect(renderDraftSupplementSection(sparse)).toBe("");
  });
});

describe("renderDingtalkTaskMarkdown", () => {
  it("renders core pipe table + more-planning pipe table", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("### 结构化任务表");
    expect(result).toContain("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止 | 执行动作 | 前置依赖 | 负责人 |");
    expect(result).toContain("| 1 | 检测任务 | 完成检测 | 报告 | 通过 | 2026-07-01 | 检测 | — | 张三 |");
    expect(result).toContain("### 更多规划（7 项）");
    expect(result).not.toContain("### 结构化任务表（列表）");
    expect(result).not.toContain("### 任务补充信息");
  });

  it("strips model single-line inline table and appends server pipe table", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "| # | 任务 | 目标 | 截止 | | 1 | X | Y | Z |",
      currentDraft: baseDraft,
      latestAssignment,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("| 1 | 检测任务 | 完成检测 |");
    expect(result).not.toMatch(/\| 1 \| X \| Y \| Z \|/);
  });

  it("shows dash assignee when no assignment", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("| 1 | 检测任务 | 完成检测 | 报告 | 通过 | 2026-07-01 | 检测 | — | — |");
  });

  it("assembly order: core table BEFORE more table BEFORE assignment BEFORE publish", () => {
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
    const coreIdx = result.indexOf("### 结构化任务表");
    const moreIdx = result.indexOf("### 更多规划（7 项）");
    const assignIdx = result.indexOf("分配建议");
    const publishIdx = result.indexOf("【已发布】");
    expect(coreIdx).toBeLessThan(moreIdx);
    expect(moreIdx).toBeLessThan(assignIdx);
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
