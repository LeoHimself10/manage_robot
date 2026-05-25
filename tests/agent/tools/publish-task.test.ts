import { describe, expect, it, vi } from "vitest";
import { buildPublishTaskHandler, createRecentPublishStore } from "../../../src/agent/tools/publish-task";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function baseSession(): PlanSession {
  return {
    chatKeyHash: "hash",
    planId: "plan-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    senderStaffId: "manager-1",
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: "测试任务",
      description: "测试任务整体背景",
      tasks: [{ id: "task-1", title: "子任务1" }],
    },
    latestAssignment: {
      assignments: [{ taskId: "task-1", primary: { userId: "emp-1" } }],
    },
  };
}

describe("publish_task handler", () => {
  it("rejects when trusted actor is missing", async () => {
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("should not call");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: {
        notifyPublishedTask: vi.fn(async () => ({
          enabled: false,
          skippedReason: "off",
          success: [],
          failed: [],
        })),
        notifyReassignedAssignee: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyManagerOfEmployeeAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeOfManagerAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifySubtaskReminder: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })),
      },
      recentPublished: createRecentPublishStore(),
    });
    await expect(handler({ planId: "plan-1" })).resolves.toEqual({
      ok: false,
      error: "trusted_actor_required",
    });
  });

  it("rejects on plan mismatch", async () => {
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("should not call");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: {
        notifyPublishedTask: vi.fn(async () => ({
          enabled: false,
          skippedReason: "off",
          success: [],
          failed: [],
        })),
        notifyReassignedAssignee: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyManagerOfEmployeeAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeOfManagerAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifySubtaskReminder: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })),
      },
      recentPublished: createRecentPublishStore(),
    });
    await expect(handler({ planId: "plan-2" })).rejects.toThrow("plan_mismatch");
  });

  it("rejects when actor is not owner", async () => {
    const session = baseSession();
    session.senderStaffId = "manager-2";
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: session,
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("should not call");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: {
        notifyPublishedTask: vi.fn(async () => ({
          enabled: false,
          skippedReason: "off",
          success: [],
          failed: [],
        })),
        notifyReassignedAssignee: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyManagerOfEmployeeAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeOfManagerAction: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifySubtaskReminder: vi.fn(async () => ({
          enabled: false,
          success: [],
          failed: [],
        })),
        notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })),
      },
      recentPublished: createRecentPublishStore(),
    });
    await expect(handler({ planId: "plan-1" })).rejects.toThrow("actor_not_owner");
  });

  it("dedupes repeated publish by recent store", async () => {
    const recent = createRecentPublishStore();
    recent.mark("plan-1");
    const notifySpy = vi.fn(async () => ({
      enabled: true,
      success: [],
      failed: [],
    }));
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("should not call");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: { notifyPublishedTask: notifySpy, notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })) },
      recentPublished: recent,
    });
    await expect(handler({ planId: "plan-1" })).resolves.toMatchObject({
      ok: true,
      alreadyPublished: true,
      dedupedByLru: true,
    });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("returns ok:false with no_draft_in_session hint when publishFromSession throws empty draft", async () => {
    const session = baseSession();
    session.latestDraft = undefined;
    session.latestAssignment = undefined;
    const notifySpy = vi.fn();
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: session,
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("latestDraft.tasks is empty, cannot publish");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: { notifyPublishedTask: notifySpy, notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })) },
      recentPublished: createRecentPublishStore(),
    });
    const res = (await handler({ planId: "plan-1" })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_draft_in_session");
    expect(String(res.hint)).toContain("prepare_publish_task");
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("returns ok:false with missing_assignee hint when publishFromSession throws missing assignee", async () => {
    const notifySpy = vi.fn();
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => {
        throw new Error("Missing assignee for subtask task_2");
      },
      appendTaskEvent: () => {},
      getContact: () => ({ active: true }),
      notifier: { notifyPublishedTask: notifySpy, notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })) },
      recentPublished: createRecentPublishStore(),
    });
    const res = (await handler({ planId: "plan-1" })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing_assignee");
    expect(res.missingTaskId).toBe("task_2");
    expect(String(res.hint)).toContain("task_2");
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("publishes successfully and reports warnings", async () => {
    const notifySpy = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "emp-1", cardMessageId: "card-1" }],
      failed: [{ userId: "emp-2", reason: "network error" }],
    }));
    const appendTaskEvent = vi.fn();
    const onAudit = vi.fn();
    const onPublishResult = vi.fn();
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      actorName: "主管A",
      initiatorDepartment: "质量部",
      publishFromSession: () => ({
        task: {
          taskId: "task:plan-1",
          taskNo: "W20260513001",
          title: "测试任务",
          description: "通知用背景",
        },
        subtasks: [
          { assigneeUserId: "emp-1", title: "子任务1", sourceTaskKey: "task_1" },
          { assigneeUserId: "emp-2", title: "子任务2", sourceTaskKey: "task_2" },
        ],
        alreadyPublished: false,
      }),
      appendTaskEvent,
      getContact: () => ({ active: true }),
      notifier: { notifyPublishedTask: notifySpy, notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })) },
      recentPublished: createRecentPublishStore(),
      onAudit,
      onPublishResult,
    });
    const res = await handler({ planId: "plan-1", confirmationContext: "确认发布" });
    expect(res).toMatchObject({
      ok: true,
      alreadyPublished: false,
      dedupedByLru: false,
      task: { taskNo: "W20260513001" },
    });
    expect(String((res as any).warnings?.[0] ?? "")).toContain("通知失败");
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(notifySpy.mock.calls[0]?.[0]).toMatchObject({
      taskNo: "W20260513001",
      taskDescription: "通知用背景",
    });
    expect(appendTaskEvent).toHaveBeenCalled();
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "publish_task_invoked",
        confirmationContext: "确认发布",
      }),
    );
    expect(onPublishResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });

  it("returns ok:false unknown_assignees (instead of throwing) when contact lookup fails", async () => {
    const notifySpy = vi.fn(async () => ({
      enabled: true,
      success: [],
      failed: [],
    }));
    const appendTaskEvent = vi.fn();
    const onPublishResult = vi.fn();
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => ({
        task: { taskId: "task:plan-1", taskNo: "W20260513002", title: "测试任务" },
        subtasks: [{ assigneeUserId: "u_yanghexin", title: "子任务1", sourceTaskKey: "task_1" }],
        alreadyPublished: false,
      }),
      appendTaskEvent,
      // contact lookup returns undefined → unknown assignee
      getContact: () => undefined,
      notifier: { notifyPublishedTask: notifySpy, notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })), notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })) },
      recentPublished: createRecentPublishStore(),
      onPublishResult,
    });
    const res = (await handler({ planId: "plan-1" })) as Record<string, unknown>;
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unknown_assignees");
    expect(res.unknownAssignees).toEqual(["u_yanghexin"]);
    expect(String(res.hint)).toContain("不在钉钉通讯录中");
    // notifier must NOT be called
    expect(notifySpy).not.toHaveBeenCalled();
    // an EMPLOYEE_NOTIFY_SKIPPED event must be written so we have a paper trail
    const skippedEvents = appendTaskEvent.mock.calls
      .map((call) => call[0])
      .filter((e: any) => e.eventType === "EMPLOYEE_NOTIFY_SKIPPED");
    expect(skippedEvents).toHaveLength(1);
    expect(skippedEvents[0].note).toContain("u_yanghexin");
    // onPublishResult still fires so caller can audit, but with ok:false
    expect(onPublishResult).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, reason: "unknown_assignees" }),
    );
  });

  it("records external executor skip warnings without treating them as notify failures", async () => {
    const notifySpy = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "emp-1" }],
      failed: [],
      skippedExternal: [{ userId: "ext_wuchuanbin", displayName: "武传宾" }],
    }));
    const appendTaskEvent = vi.fn();
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "manager-1",
      currentSessionPlanId: "plan-1",
      currentSession: baseSession(),
      initiatorDepartment: "质量部",
      publishFromSession: () => ({
        task: { taskId: "task:plan-1", taskNo: "W20260513002", title: "测试任务" },
        subtasks: [
          { assigneeUserId: "emp-1", title: "内部", sourceTaskKey: "task-1" },
          { assigneeUserId: "ext_wuchuanbin", title: "外部", sourceTaskKey: "task-1" },
        ],
        alreadyPublished: false,
      }),
      appendTaskEvent,
      getContact: (uid) => ({ active: true, name: uid === "ext_wuchuanbin" ? "武传宾" : "内部员工" }),
      notifier: {
        notifyPublishedTask: notifySpy,
        notifyReassignedAssignee: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
        notifyManagerOfEmployeeAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
        notifyEmployeeOfManagerAction: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
        notifySubtaskReminder: vi.fn(async () => ({ enabled: false, success: [], failed: [] })),
        notifyEmployeeTodoOnAccept: vi.fn(async () => ({ enabled: false })),
      },
      recentPublished: createRecentPublishStore(),
    });
    const res = (await handler({ planId: "plan-1" })) as Record<string, unknown>;
    expect(res.ok).toBe(true);
    expect(res.notifyStats).toEqual({ internalNotified: 1, externalSkipped: 1, failed: 0 });
    expect(res.warnings).toEqual(["外部执行者 武传宾 请登录网页工作台查看任务"]);
    const skippedEvents = appendTaskEvent.mock.calls
      .map((call) => call[0])
      .filter((e: { eventType?: string }) => e.eventType === "EMPLOYEE_NOTIFY_SKIPPED");
    expect(skippedEvents.some((e: { note?: string }) => e.note === "external_executor_web_only")).toBe(true);
  });
});
