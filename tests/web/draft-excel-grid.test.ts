import { describe, expect, it } from "vitest";
import {
  applyDraftScalarsFromForm,
  draftToExcelRows,
  excelRowsToDraft,
  splitListCell,
} from "../../src/web/draft-excel-grid";
import { prevalidateFromExcelRows } from "../../src/agent/workbench/draft-revise-prevalidate";

describe("draft-excel-grid", () => {
  const sampleDraft = {
    title: "质量复盘",
    description: "背景说明",
    tasks: [
      {
        id: "task_1",
        title: "根因分析",
        objective: "完成 5Why",
        deliverables: ["报告"],
        completionCriteria: ["确认"],
        timeNode: { dueAt: "2026-06-15", checkpoints: ["评审"] },
        actions: ["收集样本"],
        dependencyTaskIds: [],
        feedbackFrequency: "每周",
        inputMaterials: ["记录"],
        collaborators: ["李四"],
        scope: { inScope: ["样本"], outOfScope: [] },
        risksAndOpenQuestions: ["样本不足"],
      },
      {
        id: "task_2",
        title: "CAPA",
        objective: "方案",
        deliverables: ["文档"],
        completionCriteria: ["通过"],
        timeNode: { dueAt: "2026-06-30" },
        dependencyTaskIds: ["task_1"],
      },
    ],
  };

  it("round-trips draft to rows and back", () => {
    const assignment = {
      assignments: [
        {
          taskId: "task_1",
          primary: { displayName: "张三", userId: "u1" },
        },
      ],
    };
    const rows = draftToExcelRows({ draft: sampleDraft, assignment });
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("根因分析");
    expect(rows[0].assignee).toContain("张三");
    expect(splitListCell(rows[0].deliverables)).toEqual(["报告"]);

    const { draft, assignment: outAssign } = excelRowsToDraft({
      rows,
      previousDraft: sampleDraft,
      previousAssignment: assignment,
    });
    expect((draft.tasks as unknown[]).length).toBe(2);
    const t1 = (draft.tasks as Array<Record<string, unknown>>)[0];
    expect(t1.id).toBe("task_1");
    expect(t1.deliverables).toEqual(["报告"]);
    const a1 = (outAssign.assignments as Array<Record<string, unknown>>).find(
      (r) => r.taskId === "task_1",
    );
    expect((a1?.primary as Record<string, unknown>)?.userId).toBe("u1");
  });

  it("prevalidateFromExcelRows stabilizes ids and deps", () => {
    const rows = draftToExcelRows({ draft: sampleDraft });
    const pre = prevalidateFromExcelRows({
      rows,
      title: "新标题",
      description: "新背景",
      previousDraft: sampleDraft,
    });
    expect(pre.ok).toBe(true);
    if (pre.ok) {
      expect(pre.draft.title).toBe("新标题");
      expect(pre.draft.description).toBe("新背景");
    }
  });

  it("applyDraftScalarsFromForm updates title and description", () => {
    const next = applyDraftScalarsFromForm({ title: "旧" }, "新标题", "新描述");
    expect(next.title).toBe("新标题");
    expect(next.description).toBe("新描述");
    expect(next.summary).toBe("新描述");
  });
});
