import { describe, expect, it, vi } from "vitest";
import { buildSubmitEmployeeResponseHandler } from "../../../src/agent/tools/submit-employee-response";

describe("submit_employee_response tool", () => {
  it("calls notifyManagerOfEmployeeAction on reject", async () => {
    const updateSubtaskStatus = vi.fn(() => ({
      task: {
        taskId: "tid",
        planId: "p1",
        status: "REJECTED" as const,
        taskNo: "W-1",
        title: "Main",
        managerUserId: "mgr-1",
      },
      subtask: { subtaskId: "sid", status: "REJECTED" as const, title: "Sub" },
    }));
    const appendTaskEvent = vi.fn();
    const notifyManagerOfEmployeeAction = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "mgr-1", robotMessageKey: "x" }],
      failed: [] as Array<{ userId: string; reason: string }>,
    }));
    const handler = buildSubmitEmployeeResponseHandler({
      taskStore: { updateSubtaskStatus, appendTaskEvent, getSubtaskWithTask: () => ({
        task: {
          taskId: "tid",
          taskNo: "W-1",
          title: "Main",
          managerUserId: "mgr-1",
          planId: "p1",
        },
        subtask: { subtaskId: "sid", title: "Sub", assigneeUserId: "e1" },
      }) } as any,
      notifier: { notifyManagerOfEmployeeAction } as any,
      getDisplayName: () => "员工甲",
    });
    await handler({
      subtaskId: "sid",
      actorUserId: "e1",
      action: "reject",
      note: "无法承接",
    });
    expect(updateSubtaskStatus).toHaveBeenCalled();
    expect(appendTaskEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "EMPLOYEE_RESPONSE_SUMMARY", note: "无法承接" }),
    );
    expect(notifyManagerOfEmployeeAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rejected", managerUserId: "mgr-1" }),
    );
  });

  it("does not notify on accept", async () => {
    const updateSubtaskStatus = vi.fn(() => ({
      task: {
        taskId: "tid",
        planId: "p1",
        status: "IN_PROGRESS" as const,
        taskNo: "W-2",
        title: "Main",
        managerUserId: "mgr-1",
      },
      subtask: { subtaskId: "sid", status: "IN_PROGRESS" as const, title: "Sub" },
    }));
    const appendTaskEvent = vi.fn();
    const notifyManagerOfEmployeeAction = vi.fn();
    const handler = buildSubmitEmployeeResponseHandler({
      taskStore: { updateSubtaskStatus, appendTaskEvent, getSubtaskWithTask: () => undefined } as any,
      notifier: { notifyManagerOfEmployeeAction } as any,
    });
    await handler({
      subtaskId: "sid",
      actorUserId: "e1",
      action: "accept",
    });
    expect(notifyManagerOfEmployeeAction).not.toHaveBeenCalled();
    expect(appendTaskEvent).not.toHaveBeenCalled();
  });
});
