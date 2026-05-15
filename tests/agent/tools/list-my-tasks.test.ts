import { describe, expect, it } from "vitest";
import { buildListMyTasksHandler } from "../../../src/agent/tools/list-my-tasks";

describe("list_my_tasks tool", () => {
  it("maps taskDescription, dependsOn, checkpoints and v2 extra fields", () => {
    const handler = buildListMyTasksHandler({
      taskStore: {
        listEmployeeSubtasks: () => [
          {
            subtaskId: "s-1",
            taskId: "t-1",
            planId: "p-1",
            sourceTaskKey: "k1",
            title: "子标题",
            status: "ASSIGNED",
            assigneeUserId: "emp-1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            taskNo: "TK-1",
            taskTitle: "主任务",
            taskDescription: "主任务背景",
            managerUserId: "mgr-1",
            initiatorDepartment: "质量部",
            objective: "子目标",
            extra: {
              v: 2,
              dependsOn: ["a"],
              checkpoints: ["cp1"],
              risks: ["r1"],
              inputMaterials: ["图纸"],
              actions: ["复测"],
              collaborators: ["质量"],
              scope: { inScope: ["A"], outOfScope: ["B"] },
            },
          },
        ],
      } as any,
    });
    const out = handler({ actorUserId: "emp-1" }) as any;
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]).toMatchObject({
      taskTitle: "主任务",
      taskDescription: "主任务背景",
      objective: "子目标",
      dependsOn: ["a"],
      checkpoints: ["cp1"],
      inputMaterials: ["图纸"],
      actions: ["复测"],
      collaborators: ["质量"],
      scope: { inScope: ["A"], outOfScope: ["B"] },
    });
    expect(out.tasks[0].risks).toBeUndefined();
  });
});
