import { describe, expect, it, vi } from "vitest";
import { buildReassignTaskHandler } from "../../../src/agent/tools/reassign-task";

describe("reassign_task tool", () => {
  it("reassigns and reports session side effects", () => {
    const handler = buildReassignTaskHandler({
      taskStore: {
        reassignTask: vi.fn(() => ({
          taskId: "task:1",
          taskNo: "TASK-1",
          planId: "plan-1",
          title: "x",
          status: "ASSIGNED",
          initiatorUserId: "mgr-1",
          initiatorDepartment: "研发",
          managerUserId: "mgr-1",
          publishedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      } as any,
      planSessionStore: {
        save: vi.fn(),
        appendEvent: vi.fn(),
      } as any,
      findSessionByPlanId: () => ({
        chatKeyHash: "hash",
        planId: "plan-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        knownFacts: [],
        conversationHistory: [],
      }),
      patchAssignment: () => ({}),
    });
    const result = handler({
      actorUserId: "mgr-1",
      planId: "plan-1",
      assigneeUserId: "emp-2",
      note: "调配",
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.revisionEventWritten).toBe(true);
  });
});
