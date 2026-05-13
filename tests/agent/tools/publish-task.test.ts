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
      notifier: { notifyPublishedTask: notifySpy },
      recentPublished: recent,
    });
    await expect(handler({ planId: "plan-1" })).resolves.toMatchObject({
      ok: true,
      alreadyPublished: true,
      dedupedByLru: true,
    });
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("publishes successfully and reports warnings", async () => {
    const notifySpy = vi.fn(async () => ({
      enabled: true,
      success: [{ userId: "emp-1", cardMessageId: "card-1", todoId: "todo-1" }],
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
        task: { taskId: "task:plan-1", taskNo: "W20260513001", title: "测试任务" },
        subtasks: [
          { assigneeUserId: "emp-1", title: "子任务1" },
          { assigneeUserId: "emp-2", title: "子任务2" },
        ],
        alreadyPublished: false,
      }),
      appendTaskEvent,
      getContact: () => ({ active: true }),
      notifier: { notifyPublishedTask: notifySpy },
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
    expect(appendTaskEvent).toHaveBeenCalled();
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "publish_task_invoked",
        confirmationContext: "确认发布",
      }),
    );
    expect(onPublishResult).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
