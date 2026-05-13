import { describe, expect, it } from "vitest";
import { buildGetTaskDetailHandler } from "../../../src/agent/tools/get-task-detail";

function detailFixture() {
  return {
    task: { managerUserId: "mgr-1" },
    subtasks: [
      { assigneeUserId: "emp-1", subtaskId: "s1" },
      { assigneeUserId: "emp-2", subtaskId: "s2" },
    ],
    events: [{ event_type: "X" }],
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
    expect(() => handler({ actorUserId: "mgr-2", taskNo: "TASK-1" })).toThrow(
      "Task does not belong to current manager",
    );
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

  it("scopes employee subtasks", () => {
    const handler = buildGetTaskDetailHandler({
      taskStore: { getTaskDetail: () => detailFixture() } as any,
      actorRole: "employee",
    });
    const result = handler({ actorUserId: "emp-2", taskNo: "TASK-1" }) as any;
    expect(result.subtasks.length).toBe(1);
    expect(result.subtasks[0].assigneeUserId).toBe("emp-2");
  });
});
