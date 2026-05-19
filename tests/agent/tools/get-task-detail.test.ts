import { describe, expect, it } from "vitest";
import { buildGetTaskDetailHandler } from "../../../src/agent/tools/get-task-detail";

const baseSub = {
  taskId: "task:plan-x",
  planId: "plan-x",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function detailFixture() {
  return {
    task: { managerUserId: "mgr-1", description: "任务整体背景" },
    subtasks: [
      {
        ...baseSub,
        subtaskId: "task:plan-x:s1",
        sourceTaskKey: "k1",
        title: "我的",
        assigneeUserId: "emp-1",
        status: "ASSIGNED",
        deliverables: "mine deliverables",
        objective: "mine objective",
        extra: { v: 1 as const, dependsOn: ["k2"], checkpoints: ["c1"], risks: ["r1"] },
      },
      {
        ...baseSub,
        subtaskId: "task:plan-x:s2",
        sourceTaskKey: "k2",
        title: "同事的",
        assigneeUserId: "emp-2",
        status: "IN_PROGRESS",
        deliverables: "peer deliverables",
        objective: "peer objective",
      },
    ],
    events: [
      { event_type: "TASK_PUBLISHED", subtask_id: null },
      { event_type: "PROGRESS", subtask_id: "task:plan-x:s2" },
    ],
  };
}

describe("get_task_detail tool", () => {
  it("allows admin to read full detail", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "admin",
    });
    const result = handler({ actorUserId: "admin-1", taskNo: "TASK-1" }) as any;
    expect(result.ok).toBe(true);
    expect(result.subtasks.length).toBe(2);
  });

  it("enforces manager ownership", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "manager",
    });
    const result = handler({ actorUserId: "mgr-2", taskNo: "TASK-1" }) as any;
    expect(result).toMatchObject({
      ok: false,
      reason: "task_not_owned",
      hint: "该任务不在你的管理范围",
    });
  });

  it("returns soft error when task key is missing", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "manager",
    });
    const result = handler({ actorUserId: "mgr-1" }) as any;
    expect(result).toMatchObject({
      ok: false,
      reason: "missing_key",
      hint: "未提供任务编号或 ID",
    });
  });

  it("returns soft error when task is not found", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => undefined } as any,
      actorRole: "manager",
    });
    const result = handler({ actorUserId: "mgr-1", taskNo: "TASK-MISSING" }) as any;
    expect(result).toMatchObject({
      ok: false,
      reason: "task_not_found",
      hint: "未在工作台查到该任务编号",
      queriedKey: "TASK-MISSING",
    });
  });

  it("prefers handler-bound actorRole over model args", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "manager",
    });
    const result = handler({
      actorUserId: "mgr-1",
      actorRole: "employee",
      taskNo: "TASK-1",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.subtasks.length).toBe(2);
  });

  it("scopes employee to my subtasks and siblings whitelist", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "employee",
    });
    const result = handler({ actorUserId: "emp-1", taskNo: "TASK-1" }) as any;
    expect(result.ok).toBe(true);
    expect(result.task.description).toBe("任务整体背景");
    expect(result.subtasks).toHaveLength(1);
    expect(result.subtasks[0].assigneeUserId).toBe("emp-1");
    expect(result.mySubtasks).toHaveLength(1);
    expect(result.siblings).toHaveLength(1);
    expect(result.siblings[0]).toMatchObject({
      subtaskId: "task:plan-x:s2",
      title: "同事的",
      assigneeUserId: "emp-2",
      status: "IN_PROGRESS",
    });
    expect(result.siblings[0].deliverables).toBeUndefined();
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ event_type: "TASK_PUBLISHED" });
  });

  it("employee includeSiblings=false omits siblings", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "employee",
    });
    const result = handler({ actorUserId: "emp-1", taskNo: "TASK-1", includeSiblings: false }) as any;
    expect(result.siblings).toEqual([]);
    expect(result.includeSiblings).toBe(false);
  });

  it("returns soft error when employee does not own task", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "employee",
    });
    const result = handler({ actorUserId: "emp-3", taskNo: "TASK-1" }) as any;
    expect(result).toMatchObject({
      ok: false,
      reason: "task_not_owned",
      hint: "该任务不在你的管理范围",
    });
  });
});
