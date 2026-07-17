import { describe, expect, it, vi } from "vitest";
import {
  appendTaskIntake,
  commitTaskIntake,
} from "../../../src/agent/task-intake/commit-task-intake";
import type { TaskIntakeCommitRow } from "../../../src/agent/task-intake/types";
import type { WorkbenchPublishNotifier } from "../../../src/integrations/dingtalk/workbench-notify";

function noopNotifier(): WorkbenchPublishNotifier {
  return {
    notifyPublishedTask: vi.fn(async () => ({ success: [], failed: [], skippedExternal: [] })),
  } as unknown as WorkbenchPublishNotifier;
}

function fakeTaskStore(publishSpy: ReturnType<typeof vi.fn>) {
  return {
    publishFromSession: publishSpy,
    appendTaskEvent: vi.fn(),
  } as unknown as Parameters<typeof commitTaskIntake>[0]["taskStore"];
}

function row(over: Partial<TaskIntakeCommitRow>): TaskIntakeCommitRow {
  return {
    itemId: over.itemId ?? "ti_1",
    selected: over.selected ?? true,
    title: over.title ?? "任务",
    objective: over.objective ?? "默认目标",
    // deliverables / completionCriteria are required — defaults to non-empty stubs
    deliverables: over.deliverables ?? "默认交付物",
    completionCriteria: over.completionCriteria ?? "默认完成标准",
    actions: over.actions ?? "",
    dependsOn: over.dependsOn ?? "",
    dueAt: over.dueAt ?? "2026-12-31",
    dueMode: over.dueMode,
    dueExpectation: over.dueExpectation,
    assigneeUserId: over.assigneeUserId ?? "",
  };
}

describe("commitTaskIntake", () => {
  it("publishes a formal task when every selected row has an assignee", async () => {
    const publishSpy = vi.fn(() => ({
      task: { taskId: "t1", taskNo: "T-100", title: "父任务" },
      subtasks: [],
      alreadyPublished: false,
    }));
    const stageDraft = vi.fn();
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "描述",
      rows: [row({ itemId: "ti_1", assigneeUserId: "u1" }), row({ itemId: "ti_2", assigneeUserId: "u2" })],
      initiatorDepartment: "研发部",
      getContact: () => ({ active: true, name: "某人" }),
      notifier: noopNotifier(),
      stageDraft,
    });
    expect(result.mode).toBe("published");
    expect(result.task?.taskNo).toBe("T-100");
    expect(result.subtaskCount).toBe(2);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(stageDraft).not.toHaveBeenCalled();
  });

  it("carries optional rich fields as arrays into the published draft (agent-publish shape)", async () => {
    const publishSpy = vi.fn(() => ({
      task: { taskId: "t1", taskNo: "T-101", title: "父任务" },
      subtasks: [],
      alreadyPublished: false,
    }));
    await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "描述",
      rows: [
        row({
          itemId: "ti_1",
          assigneeUserId: "u1",
          deliverables: "交付A；交付B",
          completionCriteria: "标准1",
          actions: "动作1；动作2",
          dependsOn: "task_0",
        }),
      ],
      initiatorDepartment: "研发部",
      getContact: () => ({ active: true, name: "某人" }),
      notifier: noopNotifier(),
      stageDraft: vi.fn(),
    });
    const firstCallArg = (publishSpy.mock.calls[0] as unknown[])[0] as {
      session: { latestDraft: { tasks: Array<Record<string, unknown>> } };
    };
    const t0 = firstCallArg.session.latestDraft.tasks[0];
    expect(t0.deliverables).toEqual(["交付A", "交付B"]);
    expect(t0.completionCriteria).toEqual(["标准1"]);
    expect(t0.actions).toEqual(["动作1", "动作2"]);
    expect(t0.dependencyTaskIds).toEqual(["task_0"]);
  });

  it("returns invalid when deliverables is empty for a selected row", async () => {
    const publishSpy = vi.fn();
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "描述",
      rows: [row({ itemId: "ti_1", assigneeUserId: "u1", deliverables: "   " })],
      initiatorDepartment: "研发部",
      getContact: () => ({ active: true, name: "某人" }),
      notifier: noopNotifier(),
      stageDraft: vi.fn(),
    });
    expect(result.mode).toBe("invalid");
    expect(result.errors.some((e) => e.itemId === "ti_1" && e.message.includes("交付物"))).toBe(true);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("returns invalid when parent description is missing (aligned with agent publish gate)", async () => {
    const publishSpy = vi.fn();
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "   ",
      rows: [row({ itemId: "ti_1", assigneeUserId: "u1" })],
      initiatorDepartment: "研发部",
      getContact: () => ({ active: true, name: "某人" }),
      notifier: noopNotifier(),
      stageDraft: vi.fn(),
    });
    expect(result.mode).toBe("invalid");
    expect(result.errors.some((e) => e.itemId === "parentDescription")).toBe(true);
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("stages a draft (no publish) when any selected row lacks an assignee", async () => {
    const publishSpy = vi.fn();
    const stageDraft = vi.fn();
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "渠道复盘背景",
      rows: [row({ itemId: "ti_1", assigneeUserId: "u1" }), row({ itemId: "ti_2", assigneeUserId: "" })],
      initiatorDepartment: "研发部",
      getContact: () => undefined,
      notifier: noopNotifier(),
      stageDraft,
    });
    expect(result.mode).toBe("staged");
    expect(result.stagedDeepLink).toContain("openDraftEditor=1");
    expect(publishSpy).not.toHaveBeenCalled();
    expect(stageDraft).toHaveBeenCalledTimes(1);
    const staged = stageDraft.mock.calls[0][0];
    expect((staged.draft as { tasks: unknown[] }).tasks).toHaveLength(2);
    // assignment only carries the rows that had an assignee
    expect((staged.assignment as { assignments: unknown[] }).assignments).toHaveLength(1);
  });

  it("allows self due mode without dueAt and keeps due metadata in staged draft", async () => {
    const publishSpy = vi.fn();
    const stageDraft = vi.fn();
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "渠道复盘背景",
      rows: [
        row({
          itemId: "ti_1",
          assigneeUserId: "",
          dueAt: "",
          dueMode: "self",
          dueExpectation: "三天左右",
          objective: "由负责人评估排期",
        }),
      ],
      initiatorDepartment: "研发部",
      getContact: () => undefined,
      notifier: noopNotifier(),
      stageDraft,
    });
    expect(result.mode).toBe("staged");
    expect(publishSpy).not.toHaveBeenCalled();
    const staged = stageDraft.mock.calls[0][0];
    const task = (staged.draft as { tasks: Array<Record<string, unknown>> }).tasks[0];
    expect(task.dueMode).toBe("self");
    expect(task.dueExpectation).toBe("三天左右");
  });

  it("allows self due mode without dueExpectation as soft warning only", async () => {
    const publishSpy = vi.fn(() => ({
      task: { taskId: "t1", taskNo: "T-001", title: "父任务" },
      subtasks: [{ assigneeUserId: "u1", title: "任务" }],
      alreadyPublished: false,
    }));
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(publishSpy),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "渠道复盘背景",
      rows: [
        row({
          itemId: "ti_1",
          assigneeUserId: "u1",
          dueAt: "",
          dueMode: "self",
          dueExpectation: "",
          objective: "由负责人评估排期",
        }),
      ],
      initiatorDepartment: "研发部",
      getContact: () => ({ active: true, name: "某人" }),
      notifier: noopNotifier(),
      stageDraft: vi.fn(),
    });
    expect(result.mode).toBe("published");
    expect(result.errors.some((e) => e.message.includes("建议填写期望时间"))).toBe(true);
  });

  it("returns empty when no rows are selected", async () => {
    const result = await commitTaskIntake({
      taskStore: fakeTaskStore(vi.fn()),
      managerUserId: "mgr-1",
      parentTitle: "父任务",
      parentDescription: "描述",
      rows: [row({ selected: false, assigneeUserId: "u1" })],
      initiatorDepartment: "研发部",
      getContact: () => undefined,
      notifier: noopNotifier(),
      stageDraft: vi.fn(),
    });
    expect(result.mode).toBe("empty");
  });
});

describe("appendTaskIntake", () => {
  function appendStore(options?: { duplicated?: boolean }) {
    const appendTaskEvent = vi.fn();
    const appendSubtask = vi.fn((input: { title: string; assigneeUserId: string }) => ({
      task: {
        taskId: "task-existing",
        taskNo: "TASK-EXISTING",
        planId: "plan-existing",
        title: "已有父任务",
        description: "父任务背景",
      },
      subtask: {
        subtaskId: `sub-${input.title}`,
        title: input.title,
        assigneeUserId: input.assigneeUserId,
      },
      duplicated: options?.duplicated === true,
    }));
    return {
      store: { appendSubtask, appendTaskEvent } as unknown as Parameters<
        typeof appendTaskIntake
      >[0]["taskStore"],
      appendSubtask,
      appendTaskEvent,
    };
  }

  it("sends one grouped publish notification and audits every appended subtask", async () => {
    const { store, appendTaskEvent } = appendStore();
    const notifyPublishedTask = vi.fn(async (
      _input: Parameters<WorkbenchPublishNotifier["notifyPublishedTask"]>[0],
    ) => ({
      enabled: true,
      success: [{ userId: "emp-1", cardMessageId: "card-1", robotMessageKey: "robot-1" }],
      failed: [],
      skippedExternal: [],
    }));

    const result = await appendTaskIntake({
      taskStore: store,
      managerUserId: "mgr-1",
      targetPlanId: "plan-existing",
      actorName: "主管甲",
      rows: [
        row({ itemId: "ti-1", title: "追加一", assigneeUserId: "emp-1" }),
        row({ itemId: "ti-2", title: "追加二", assigneeUserId: "emp-1" }),
      ],
      notifier: { notifyPublishedTask } as unknown as WorkbenchPublishNotifier,
      getContact: (userId) => ({ name: userId === "mgr-1" ? "主管甲" : "员工甲" }),
    });

    expect(result.mode).toBe("appended");
    expect(notifyPublishedTask).toHaveBeenCalledTimes(1);
    const notifyInput = notifyPublishedTask.mock.calls[0][0];
    expect(notifyInput.assignees).toHaveLength(1);
    expect(notifyInput.assignees[0].subtasks).toEqual([
      { title: "追加一" },
      { title: "追加二" },
    ]);
    expect(appendTaskEvent).toHaveBeenCalledTimes(2);
    expect(appendTaskEvent.mock.calls.every(([event]) => event.eventType === "SUBTASK_ADD_NOTIFY_OK"))
      .toBe(true);
  });

  it("does not send another notification when appendSubtask reports a duplicate", async () => {
    const { store, appendTaskEvent } = appendStore({ duplicated: true });
    const notifyPublishedTask = vi.fn();

    const result = await appendTaskIntake({
      taskStore: store,
      managerUserId: "mgr-1",
      targetPlanId: "plan-existing",
      rows: [row({ itemId: "ti-1", title: "重复追加", assigneeUserId: "emp-1" })],
      notifier: { notifyPublishedTask } as unknown as WorkbenchPublishNotifier,
      getContact: () => undefined,
    });

    expect(result.mode).toBe("appended");
    expect(notifyPublishedTask).not.toHaveBeenCalled();
    expect(appendTaskEvent).not.toHaveBeenCalled();
  });
});
