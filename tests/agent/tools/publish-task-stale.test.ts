import { describe, expect, it, vi } from "vitest";
import { buildPublishTaskHandler } from "../../../src/agent/tools/publish-task";
import type { PlanSession } from "../../../src/infra/plan-session-store";

describe("publish_task stale_staging", () => {
  it("returns stale_staging when draft changed after prepare", async () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "plan-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "T",
        description: "D",
        tasks: [{ id: "task_1", title: "子任务", objective: "o" }],
        stagedBy: "prepare_publish_task",
        stagedAt: new Date().toISOString(),
        stagedDraftHash: "old-hash",
        stagedAssignmentHash: "assign-hash",
      },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-1" } }],
      },
    };
    const handler = buildPublishTaskHandler({
      trustedActorUserId: "mgr-1",
      currentSessionPlanId: "plan-1",
      currentSession: session,
      initiatorDepartment: "研发",
      publishFromSession: vi.fn(),
      appendTaskEvent: vi.fn(),
      getContact: () => ({ active: true, unionId: "u" }),
      notifier: { notifyPublishedTask: vi.fn() } as any,
      recentPublished: { get: () => undefined, mark: vi.fn() },
    });
    const result = (await handler({ planId: "plan-1" })) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stale_staging");
  });
});
