import { describe, expect, it, vi } from "vitest";
import { buildPreparePublishArgsFromSession } from "../../src/agent/authoritative-publish";
import type { PlanSession } from "../../src/infra/plan-session-store";

describe("authoritative-publish", () => {
  it("buildPreparePublishArgsFromSession merges draft and assignment", () => {
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "plan-1",
      createdAt: "2026-05-19T00:00:00.000Z",
      updatedAt: "2026-05-19T00:00:00.000Z",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "主任务",
        description: "背景说明",
        tasks: [
          {
            id: "task_1",
            title: "子任务A",
            timeNode: { dueAt: "2026-06-01" },
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "641728622" } }],
      },
    };
    const args = buildPreparePublishArgsFromSession(session);
    expect(args).toMatchObject({
      planId: "plan-1",
      title: "主任务",
      description: "背景说明",
    });
    expect(args?.subtasks).toEqual([
      expect.objectContaining({
        taskId: "task_1",
        assigneeUserId: "641728622",
      }),
    ]);
  });
});
