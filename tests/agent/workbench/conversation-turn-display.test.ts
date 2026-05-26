import { describe, expect, it } from "vitest";
import type { PlanSession } from "../../../src/infra/plan-session-store";
import { buildBulkAssignTasksHandler } from "../../../src/agent/tools/bulk-assign-tasks";
import { buildPreparePublishTaskHandler } from "../../../src/agent/tools/prepare-publish-task";
import { buildWorkbenchTurnDisplay } from "../../../src/agent/workbench/conversation-turn-display";
import type { OrchestratorResult } from "../../../src/agent/orchestrator";

const ASSIGNEE_ID = "02573051084320";
const ASSIGNEE_NAME = "李嘉男";

function makeSession(): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "hash-workbench-display",
    planId: "plan-display-test",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    lastEmployeeSearchHits: [{ userId: ASSIGNEE_ID, displayName: ASSIGNEE_NAME, hitAt: now }],
    latestDraft: {
      title: "微导管供应商与双管线决策",
      description: "获取供应商反馈并评估签约可行性。",
      tasks: [
        { id: "task_1", title: "获取并评估Pro18仿制可行性", objective: "供应商反馈与内评" },
        { id: "task_2", title: "定义激光光纤微导管需求边界", objective: "明确指标与验收" },
        { id: "task_3", title: "综合评估与签约决策", objective: "形成决策建议" },
      ],
    },
  } as PlanSession;
}

describe("buildWorkbenchTurnDisplay", () => {
  it("keeps assignee names after bulk_assign + prepare in the same turn", () => {
    const session = makeSession();
    const preTurnDraft = session.latestDraft;
    const preTurnAssignment = session.latestAssignment;

    const getContact = (userId: string) =>
      userId === ASSIGNEE_ID
        ? { active: true, name: ASSIGNEE_NAME, unionId: "union-local" }
        : undefined;

    const bulk = buildBulkAssignTasksHandler({ currentSession: session, getContact });
    const bulkRes = bulk({
      assignments: [
        { taskId: "task_1", assigneeUserId: ASSIGNEE_ID },
        { taskId: "task_2", assigneeUserId: ASSIGNEE_ID },
        { taskId: "task_3", assigneeUserId: ASSIGNEE_ID },
      ],
    }) as { ok: boolean };
    expect(bulkRes.ok).toBe(true);

    const prep = buildPreparePublishTaskHandler({ currentSession: session, getContact });
    const prepRes = prep({ planId: session.planId }) as { ok: boolean };
    expect(prepRes.ok).toBe(true);

    const orchResult: OrchestratorResult = {
      traceId: "trace-workbench-display",
      messages: ["已完成负责人指派并生成发布预览。"],
      toolInvocationNames: ["bulk_assign_tasks", "prepare_publish_task"],
      toolCallsTotal: 2,
    };

    const turnDisplay = buildWorkbenchTurnDisplay({
      orchResult,
      session,
      preTurnDraft,
      preTurnAssignment,
      postTurnDraft: session.latestDraft,
      modelName: "qwen-test",
      employees: [{ userId: ASSIGNEE_ID, displayName: ASSIGNEE_NAME }],
    });

    expect(turnDisplay.latestAssignment).toBeDefined();
    const rows = (turnDisplay.latestAssignment as { assignments: Array<{ primary?: { displayName?: string } }> })
      .assignments;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(String(row.primary?.displayName ?? "").trim()).toBe(ASSIGNEE_NAME);
    }

    expect(turnDisplay.displayContent).toContain(ASSIGNEE_NAME);
    expect(turnDisplay.displayContent).not.toContain(ASSIGNEE_ID);
  });
});
