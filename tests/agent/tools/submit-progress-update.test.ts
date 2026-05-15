import { describe, expect, it, vi } from "vitest";
import { buildSubmitProgressUpdateHandler } from "../../../src/agent/tools/submit-progress-update";

describe("submit_progress_update tool", () => {
  it("notifies manager on BLOCKED and DONE, not on IN_PROGRESS", async () => {
    const notifyManagerOfEmployeeAction = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "mgr-1" }],
      failed: [] as Array<{ userId: string; reason: string }>,
    }));
    const baseStore = {
      appendTaskEvent: vi.fn(),
      getSubtaskWithTask: () => ({
        task: {
          taskId: "tid",
          taskNo: "W-9",
          title: "T",
          managerUserId: "mgr-1",
          planId: "p",
        },
        subtask: { subtaskId: "sid", title: "St", assigneeUserId: "e1" },
      }),
    };
    const handler = buildSubmitProgressUpdateHandler({
      taskStore: {
        ...baseStore,
        updateSubtaskStatus: vi.fn(() => ({
          task: { taskId: "tid", planId: "p", status: "BLOCKED" as const, taskNo: "W-9", title: "T", managerUserId: "mgr-1" },
          subtask: { subtaskId: "sid", status: "BLOCKED" as const, title: "St" },
        })),
      } as any,
      notifier: { notifyManagerOfEmployeeAction } as any,
    });
    await handler({
      subtaskId: "sid",
      actorUserId: "e1",
      progressStatus: "BLOCKED",
      note: "缺料",
    });
    expect(notifyManagerOfEmployeeAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "blocked" }));
    notifyManagerOfEmployeeAction.mockClear();

    const handlerDone = buildSubmitProgressUpdateHandler({
      taskStore: {
        ...baseStore,
        updateSubtaskStatus: vi.fn(() => ({
          task: { taskId: "tid", planId: "p", status: "DONE" as const, taskNo: "W-9", title: "T", managerUserId: "mgr-1" },
          subtask: { subtaskId: "sid", status: "DONE" as const, title: "St" },
        })),
      } as any,
      notifier: { notifyManagerOfEmployeeAction } as any,
    });
    await handlerDone({
      subtaskId: "sid",
      actorUserId: "e1",
      progressStatus: "DONE",
      note: "已完成",
    });
    expect(notifyManagerOfEmployeeAction).toHaveBeenCalledWith(expect.objectContaining({ kind: "done" }));
    notifyManagerOfEmployeeAction.mockClear();

    const handlerProg = buildSubmitProgressUpdateHandler({
      taskStore: {
        ...baseStore,
        updateSubtaskStatus: vi.fn(() => ({
          task: { taskId: "tid", planId: "p", status: "IN_PROGRESS" as const, taskNo: "W-9", title: "T", managerUserId: "mgr-1" },
          subtask: { subtaskId: "sid", status: "IN_PROGRESS" as const, title: "St" },
        })),
      } as any,
      notifier: { notifyManagerOfEmployeeAction } as any,
    });
    await handlerProg({
      subtaskId: "sid",
      actorUserId: "e1",
      progressStatus: "IN_PROGRESS",
      note: "继续推进",
    });
    expect(notifyManagerOfEmployeeAction).not.toHaveBeenCalled();
  });
});
