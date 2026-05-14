import { describe, expect, it } from "vitest";
import { buildPreparePublishTaskHandler } from "../../../src/agent/tools/prepare-publish-task";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    knownFacts: [],
    conversationHistory: [],
    ...overrides,
  };
}

describe("prepare_publish_task tool", () => {
  it("returns missing assignee hint instead of throwing", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      planId: "plan-1",
      title: "测试发布",
      subtasks: [
        { taskId: "task_1", title: "任务1", assigneeUserId: "" },
        { taskId: "task_2", title: "任务2", assigneeUserId: "emp-2" },
      ],
    }) as any;
    expect(result).toMatchObject({
      ok: false,
      reason: "missing_assignee",
      missingTaskIds: ["task_1"],
    });
    expect(String(result.hint)).toContain("task_1");
  });

  it("prepares publish payload when all assignees exist", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      planId: "plan-1",
      title: "测试发布",
      subtasks: [
        { taskId: "task_1", title: "任务1", assigneeUserId: "emp-1" },
      ],
    }) as any;
    expect(result.ok).toBe(true);
    expect(result.requiresManagerConfirm).toBe(true);
    expect(result.subtasks).toHaveLength(1);
  });

  it("stages draft + assignment into provided session on success", () => {
    const session = makeSession();
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();

    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-1",
      title: "U盘兼容性故障排查与修复",
      subtasks: [
        {
          taskId: "task_1",
          title: "故障复现与兼容性摸底",
          assigneeUserId: "emp-lu-li",
          objective: "复现并定位",
          dueAt: "2026-05-20",
        },
      ],
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.staged).toBe(true);
    const draft = session.latestDraft as Record<string, unknown> | undefined;
    expect(draft).toBeDefined();
    expect(draft?.title).toBe("U盘兼容性故障排查与修复");
    const tasks = (draft?.tasks ?? []) as Array<Record<string, unknown>>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: "task_1",
      title: "故障复现与兼容性摸底",
      objective: "复现并定位",
      timeNode: { dueAt: "2026-05-20" },
    });
    const assignment = session.latestAssignment as Record<string, unknown> | undefined;
    expect(assignment).toBeDefined();
    const assignments = (assignment?.assignments ?? []) as Array<Record<string, unknown>>;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      taskId: "task_1",
      primary: { userId: "emp-lu-li" },
      confidence: "HIGH",
    });
  });

  it("rejects plan mismatch instead of mutating session", () => {
    const session = makeSession({ planId: "plan-real" });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-wrong",
      title: "测试",
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "emp-1" }],
    }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("plan_mismatch");
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();
  });

  it("does not mutate session when subtasks lack assignees", () => {
    const session = makeSession();
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-1",
      title: "测试",
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "" }],
    }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_assignee");
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();
  });

  it("falls back to ok:false (not throw) when planId missing", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      title: "测试",
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "emp-1" }],
    }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_plan_id");
  });
});
