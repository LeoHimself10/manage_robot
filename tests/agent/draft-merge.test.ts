import { describe, expect, it } from "vitest";
import { deepMergePreserveRichFields } from "../../src/agent/draft-merge";

describe("deepMergePreserveRichFields", () => {
  it("returns next unchanged when prev is undefined", () => {
    const next = { title: "T", tasks: [{ id: "t1", title: "sub" }] };
    expect(deepMergePreserveRichFields(undefined, next)).toEqual(next);
  });

  it("merges top-level scalar from next over prev", () => {
    const prev = { title: "old", description: "old desc" };
    const next = { title: "new" };
    const result = deepMergePreserveRichFields(prev, next);
    expect(result.title).toBe("new");
    expect(result.description).toBe("old desc");
  });

  it("preserves prev tasks when next has no tasks", () => {
    const prev = { title: "T", tasks: [{ id: "t1", title: "前置" }] };
    const next = { title: "T updated" };
    const result = deepMergePreserveRichFields(prev, next);
    expect((result.tasks as any[]).length).toBe(1);
    expect((result.tasks as any[])[0].title).toBe("前置");
  });

  it("preserves rich array fields in matched task when next sends empty array", () => {
    const prev = {
      tasks: [
        {
          id: "t1",
          title: "检测",
          deliverables: ["报告 v1"],
          inputMaterials: ["图纸"],
          actions: ["测试"],
          collaborators: ["张三"],
          risksAndOpenQuestions: ["设备停机"],
          dependencyTaskIds: ["task_0"],
          timeNode: { dueAt: "2026-07-01", checkpoints: ["中期"] },
        },
      ],
    };
    const next = {
      tasks: [
        {
          id: "t1",
          title: "检测（更新标题）",
          deliverables: [],
          inputMaterials: [],
          actions: [],
          collaborators: [],
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
          timeNode: { dueAt: "2026-07-15" },
        },
      ],
    };
    const result = deepMergePreserveRichFields(prev, next);
    const t1 = (result.tasks as any[])[0];
    expect(t1.title).toBe("检测（更新标题）");
    expect(t1.deliverables).toEqual(["报告 v1"]);
    expect(t1.inputMaterials).toEqual(["图纸"]);
    expect(t1.actions).toEqual(["测试"]);
    expect(t1.collaborators).toEqual(["张三"]);
    expect(t1.risksAndOpenQuestions).toEqual(["设备停机"]);
    expect(t1.dependencyTaskIds).toEqual(["task_0"]);
    // dueAt updated but old checkpoints preserved
    expect(t1.timeNode.dueAt).toBe("2026-07-15");
    expect(t1.timeNode.checkpoints).toEqual(["中期"]);
  });

  it("takes new non-empty array from next, overriding prev", () => {
    const prev = {
      tasks: [{ id: "t1", title: "T", deliverables: ["旧交付物"] }],
    };
    const next = {
      tasks: [{ id: "t1", title: "T", deliverables: ["新交付物", "附件"] }],
    };
    const result = deepMergePreserveRichFields(prev, next);
    expect((result.tasks as any[])[0].deliverables).toEqual(["新交付物", "附件"]);
  });

  it("preserves scope fields from prev when next omits them", () => {
    const prev = {
      tasks: [
        {
          id: "t1",
          title: "T",
          scope: { inScope: ["功能 A"], outOfScope: ["不做性能"] },
        },
      ],
    };
    const next = {
      tasks: [{ id: "t1", title: "T（更新）" }],
    };
    const result = deepMergePreserveRichFields(prev, next);
    const t1 = (result.tasks as any[])[0];
    expect(t1.scope?.inScope).toEqual(["功能 A"]);
    expect(t1.scope?.outOfScope).toEqual(["不做性能"]);
  });

  it("adds new tasks that were not in prev", () => {
    const prev = {
      tasks: [{ id: "t1", title: "任务1" }],
    };
    const next = {
      tasks: [
        { id: "t1", title: "任务1" },
        { id: "t2", title: "任务2", deliverables: ["新交付"] },
      ],
    };
    const result = deepMergePreserveRichFields(prev, next);
    expect((result.tasks as any[]).length).toBe(2);
    expect((result.tasks as any[])[1].title).toBe("任务2");
  });
});
