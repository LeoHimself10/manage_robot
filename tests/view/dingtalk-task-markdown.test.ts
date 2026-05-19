import { describe, expect, it, vi } from "vitest";
import {
  hasTaskTableInMessage,
  renderDraftSupplementSection,
  appendPublishSummaryMarkdown,
  renderDingtalkTaskMarkdown,
} from "../../src/view/dingtalk-task-markdown";

// ---------------------------------------------------------------------------
// hasTaskTableInMessage
// ---------------------------------------------------------------------------

describe("hasTaskTableInMessage", () => {
  it("returns false for plain text", () => {
    expect(hasTaskTableInMessage("好的，请告诉我截止时间。")).toBe(false);
  });
  it("detects structured table header", () => {
    expect(hasTaskTableInMessage("### 任务列表（结构化字段）\n| # | 任务 |")).toBe(true);
  });
  it("detects old draft header", () => {
    expect(hasTaskTableInMessage("### 任务草案（结构化字段）")).toBe(true);
  });
  it("detects markdown table with known columns", () => {
    expect(hasTaskTableInMessage("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |")).toBe(true);
  });
  it("is case-insensitive", () => {
    expect(hasTaskTableInMessage("### 任务列表（结构化字段）")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// renderDraftSupplementSection
// ---------------------------------------------------------------------------

describe("renderDraftSupplementSection", () => {
  it("returns empty string for null/undefined draft", () => {
    expect(renderDraftSupplementSection(null)).toBe("");
    expect(renderDraftSupplementSection(undefined)).toBe("");
    expect(renderDraftSupplementSection("string")).toBe("");
  });

  it("returns empty string when draft has no tasks and no description", () => {
    expect(renderDraftSupplementSection({ tasks: [] })).toBe("");
    expect(renderDraftSupplementSection({})).toBe("");
  });

  it("renders supplement block without duplicate task table", () => {
    const draft = {
      tasks: [
        {
          id: "task_1",
          title: "产线巡检",
          objective: "完成每日巡检",
          deliverables: ["检查报告"],
          completionCriteria: ["无漏项"],
          timeNode: { dueAt: "2026-06-01", checkpoints: ["中期确认"] },
          risksAndOpenQuestions: ["设备停机风险"],
          feedbackFrequency: "每日",
        },
      ],
    };
    const result = renderDraftSupplementSection(draft);
    expect(result).not.toContain("### 任务草案（结构化字段）");
    expect(result).not.toContain("| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |");
    expect(result).toContain("### 任务补充信息");
    expect(result).toContain("产线巡检");
    expect(result).toContain("检查点：中期确认");
    expect(result).toContain("风险与待澄清：设备停机风险");
  });

  it("returns empty when draft has only basic task fields (main table elsewhere)", () => {
    const draft = {
      tasks: [
        {
          id: "task_1",
          title: "基础任务",
          objective: "目标",
          deliverables: ["交付"],
          completionCriteria: ["标准"],
          timeNode: { dueAt: "2026-06-01" },
          feedbackFrequency: "每日",
        },
      ],
    };
    expect(renderDraftSupplementSection(draft)).toBe("");
  });

  it("renders rich v2 fields (inputMaterials/actions/collaborators/scope)", () => {
    const draft = {
      tasks: [
        {
          id: "task_1",
          title: "需求评审",
          inputMaterials: ["需求文档"],
          actions: ["评审会议"],
          collaborators: ["产品经理"],
          scope: { inScope: ["功能 A"], outOfScope: ["不做性能"] },
          dependencyTaskIds: [],
          timeNode: {},
          risksAndOpenQuestions: [],
        },
      ],
    };
    const result = renderDraftSupplementSection(draft);
    expect(result).toContain("输入材料：需求文档");
    expect(result).toContain("执行动作：评审会议");
    expect(result).toContain("协作人：产品经理");
    expect(result).toContain("范围内：功能 A");
    expect(result).toContain("范围外：不做性能");
  });

  it("renders dependency with resolved titles", () => {
    const draft = {
      tasks: [
        { id: "task_1", title: "前置", dependencyTaskIds: [], timeNode: {}, risksAndOpenQuestions: [] },
        {
          id: "task_2",
          title: "后续",
          dependencyTaskIds: ["task_1"],
          timeNode: {},
          risksAndOpenQuestions: [],
        },
      ],
    };
    const result = renderDraftSupplementSection(draft);
    expect(result).toContain("前置依赖：task_1（前置）");
  });

  it("renders description when present", () => {
    const draft = {
      description: "项目背景说明",
      tasks: [{ id: "t1", title: "子任务", timeNode: {}, risksAndOpenQuestions: [], dependencyTaskIds: [] }],
    };
    const result = renderDraftSupplementSection(draft);
    expect(result).toContain("**任务背景**：项目背景说明");
  });
});

// ---------------------------------------------------------------------------
// appendPublishSummaryMarkdown
// ---------------------------------------------------------------------------

describe("appendPublishSummaryMarkdown", () => {
  it("returns unchanged markdown when publishResult is undefined", () => {
    expect(appendPublishSummaryMarkdown("草案消息")).toBe("草案消息");
  });

  it("returns unchanged markdown when ok !== true", () => {
    expect(appendPublishSummaryMarkdown("草案消息", { ok: false })).toBe("草案消息");
  });

  it("appends already-published message", () => {
    const result = appendPublishSummaryMarkdown("草案消息", {
      ok: true,
      alreadyPublished: true,
      task: { taskNo: "W001" },
    });
    expect(result).toContain("【已发布】此计划已发布过（任务编号 W001），未重复推送。");
  });

  it("appends fresh publish receipt with subtask count", () => {
    const result = appendPublishSummaryMarkdown("草案消息", {
      ok: true,
      alreadyPublished: false,
      task: { taskNo: "W002", title: "品质检查" },
      subtasks: [
        { assigneeUserId: "u1" },
        { assigneeUserId: "u2" },
      ],
    });
    expect(result).toContain("【已发布】任务编号 W002");
    expect(result).toContain("品质检查");
    expect(result).toContain("子任务 2 个 → 已通知 2 名员工");
  });

  it("appends warnings when present", () => {
    const result = appendPublishSummaryMarkdown("草案消息", {
      ok: true,
      alreadyPublished: false,
      task: { taskNo: "W003", title: "T" },
      subtasks: [],
      warnings: ["通知失败：员工 A"],
    });
    expect(result).toContain("通知失败：员工 A");
  });
});

// ---------------------------------------------------------------------------
// renderDingtalkTaskMarkdown – assembly order tests
// ---------------------------------------------------------------------------

describe("renderDingtalkTaskMarkdown", () => {
  const baseDraft = {
    tasks: [
      {
        id: "task_1",
        title: "检测任务",
        objective: "完成检测",
        deliverables: [],
        completionCriteria: [],
        timeNode: { dueAt: "2026-07-01", checkpoints: ["中期"] },
        risksAndOpenQuestions: ["资源不足"],
        feedbackFrequency: "每周",
      },
    ],
  };

  it("returns modelMessage unchanged when shouldRenderRichSection=false", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      shouldRenderRichSection: false,
      appendStructuredTaskTable: true,
    });
    expect(result).toBe("模型回复");
  });

  it("appends rich supplement section when shouldRenderRichSection=true", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "模型回复",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
    });
    expect(result).toContain("模型回复");
    expect(result).toContain("### 任务列表（结构化字段）");
    expect(result).toContain("### 任务补充信息");
    expect(result).toContain("检测任务");
    const tableHeaderCount = (result.match(/\| # \| 任务 \| 目标 \| 交付物 \| 完成标准 \| 截止日期 \| 反馈频率 \|/g) ?? []).length;
    expect(tableHeaderCount).toBe(1);
  });

  it("does not render rich section when planRotatedAfterPublish (shouldRenderRichSection=false)", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "已发布！",
      currentDraft: baseDraft,
      shouldRenderRichSection: false,
      appendStructuredTaskTable: true,
      publishResult: {
        ok: true,
        alreadyPublished: false,
        task: { taskNo: "W005", title: "T" },
        subtasks: [{ assigneeUserId: "u1" }],
      },
    });
    expect(result).not.toContain("### 任务列表（结构化字段）");
    expect(result).toContain("【已发布】");
  });

  it("assembly order: richSection BEFORE assignmentSection BEFORE publishSummary BEFORE rotateTail", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "消息",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
      assignmentSection: "\n\n分配建议：张三",
      publishResult: {
        ok: true,
        alreadyPublished: false,
        task: { taskNo: "W006", title: "T" },
        subtasks: [{ assigneeUserId: "u1" }],
      },
      rotatePlanHintTail: "\n\n---\n已切换新任务上下文",
    });
    const richIdx = result.indexOf("### 任务列表（结构化字段）");
    const assignIdx = result.indexOf("分配建议：张三");
    const publishIdx = result.indexOf("【已发布】");
    const rotateIdx = result.indexOf("已切换新任务上下文");
    expect(richIdx).toBeGreaterThan(-1);
    expect(assignIdx).toBeGreaterThan(richIdx);
    expect(publishIdx).toBeGreaterThan(assignIdx);
    expect(rotateIdx).toBeGreaterThan(publishIdx);
  });

  it("calls onModelDrewTable when model already rendered a table", () => {
    const onModelDrewTable = vi.fn();
    renderDingtalkTaskMarkdown({
      modelMessage: "### 任务列表（结构化字段）\n| # | 任务 | 目标 | 交付物 | 完成标准 | 截止日期 | 反馈频率 |\n|---|---|---|---|---|---|---|\n| 1 | T |",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: true,
      onModelDrewTable,
    });
    expect(onModelDrewTable).toHaveBeenCalledOnce();
  });

  it("skips appendStructuredTaskTable when flag is false", () => {
    const result = renderDingtalkTaskMarkdown({
      modelMessage: "消息",
      currentDraft: baseDraft,
      shouldRenderRichSection: true,
      appendStructuredTaskTable: false,
    });
    expect(result).not.toContain("### 任务列表（结构化字段）");
    // Supplement section (risks/checkpoints) should still be rendered
    expect(result).toContain("### 任务补充信息");
  });
});
