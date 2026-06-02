import { describe, expect, it, vi } from "vitest";
import type { WorkbenchPublishNotifier } from "../../../src/integrations/dingtalk/workbench-notify";
import { notifyManagerOfEmployeeActionAfterUpdate } from "../../../src/integrations/dingtalk/manager-notify-on-employee-action";

describe("notifyManagerOfEmployeeActionAfterUpdate", () => {
  it("skips notify when manager is the assignee (self-assignment)", async () => {
    const notifyManagerOfEmployeeAction = vi.fn();
    await notifyManagerOfEmployeeActionAfterUpdate({
      taskStore: {
        getSubtaskWithTask: () => ({
          task: {
            taskId: "t1",
            taskNo: "TK-1",
            title: "T",
            managerUserId: "mgr-self",
          },
          subtask: { subtaskId: "s1", title: "S" },
        }),
        appendTaskEvent: vi.fn(),
      } as unknown as Parameters<typeof notifyManagerOfEmployeeActionAfterUpdate>[0]["taskStore"],
      notifier: { notifyManagerOfEmployeeAction } as unknown as WorkbenchPublishNotifier,
      subtaskId: "s1",
      actorUserId: "mgr-self",
      kind: "rejected",
      note: "no",
    });
    expect(notifyManagerOfEmployeeAction).not.toHaveBeenCalled();
  });
});
