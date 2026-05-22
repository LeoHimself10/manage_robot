import { describe, expect, it } from "vitest";
import { buildUpdateDraftTaskHandler } from "../../../src/agent/tools/update-draft-task";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSessionWithDraft(): PlanSession {
  const now = new Date().toISOString();
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: now,
    updatedAt: now,
    knownFacts: [],
    conversationHistory: [],
    currentTaskScopeId: "scope:default",
    taskScopes: {},
    lastEmployeeSearchHits: [
      { userId: "641872345", displayName: "李四", hitAt: now },
      { userId: "641000001", displayName: "王五", hitAt: now },
    ],
    latestDraft: {
      title: "无纺布 KT 批次不合格处置",
      tasks: [
        {
          id: "task_1",
          title: "紧急全检与隔离",
          objective: "对 KT20260513-03 批次全数检测",
          timeNode: { dueAt: "2026-05-15 17:00" },
        },
        {
          id: "task_2",
          title: "供应商沟通",
          objective: "联系康泰退货",
        },
      ],
    },
    latestAssignment: {
      assignments: [
        { taskId: "task_1", primary: { userId: "641728622" }, confidence: "HIGH" },
        { taskId: "task_2", primary: { userId: "641728622" }, confidence: "HIGH" },
      ],
    },
  };
}

describe("update_draft_task tool", () => {
  it("fails when session missing", () => {
    const handler = buildUpdateDraftTaskHandler();
    const result = handler({ subtaskId: "task_1", patch: { title: "x" } }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("session_unavailable");
  });

  it("fails with no_draft when session has no latestDraft", () => {
    const now = new Date().toISOString();
    const handler = buildUpdateDraftTaskHandler({
      currentSession: {
        chatKeyHash: "h",
        planId: "p",
        createdAt: now,
        updatedAt: now,
        knownFacts: [],
        conversationHistory: [],
      },
    });
    const result = handler({ subtaskId: "task_1", patch: { title: "x" } }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_draft");
  });

  it("updates title / objective / dueAt in place", () => {
    const session = makeSessionWithDraft();
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const result = handler({
      subtaskId: "task_1",
      patch: {
        title: "紧急全检 (改后)",
        objective: "对 KT 批次 100% 检测",
        dueAt: "2026-05-16 12:00",
      },
    }) as any;
    expect(result.ok).toBe(true);
    const tasks = (session.latestDraft as any).tasks;
    expect(tasks[0].title).toBe("紧急全检 (改后)");
  });

  it("rejects assigneeUserId not from search cache", () => {
    const session = makeSessionWithDraft();
    const handler = buildUpdateDraftTaskHandler({
      currentSession: session,
      getContact: (uid) => (uid === "641872345" ? { active: true, unionId: "u1" } : undefined),
    });
    const bad = handler({ subtaskId: "task_1", patch: { assigneeUserId: "u_fake" } }) as any;
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("assignee_not_from_search");

    const good = handler({ subtaskId: "task_1", patch: { assigneeUserId: "641872345" } }) as any;
    expect(good.ok).toBe(true);
    expect(good.assignee.displayName).toBe("李四");
    const assignments = (session.latestAssignment as any).assignments;
    expect(assignments.find((a: any) => a.taskId === "task_1").primary.userId).toBe("641872345");
    expect((session.latestDraft as any).tasks[0].assigneeUserId).toBeUndefined();
  });

  it("updates display row 2 when subtaskId is task_2 after split id drift", () => {
    const now = new Date().toISOString();
    const session: PlanSession = {
      chatKeyHash: "h",
      planId: "p",
      createdAt: now,
      updatedAt: now,
      knownFacts: [],
      conversationHistory: [],
      candidatePool: {
        source: "eval",
        entries: [{ userId: "u-yang", displayName: "杨贺新" }],
        unresolved: [],
      },
      latestDraft: {
        tasks: [
          { id: "task_1", title: "Split A", timeNode: { dueAt: "2026-06-10" } },
          { id: "task_1b", title: "Split B", timeNode: { dueAt: "2026-06-10" } },
          { id: "task_2", title: "包装材料准备", timeNode: { dueAt: "2026-06-12" } },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "u-yao" } },
          { taskId: "task_1b", primary: { userId: "u-yao" } },
          { taskId: "task_2", primary: { userId: "u-yao" } },
        ],
      },
    };
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const result = handler({
      subtaskId: "task_2",
      patch: { dueAt: "2026-05-28", assigneeUserId: "u-yang" },
    }) as { ok: boolean; displayIndex?: number; resolvedTaskId?: string };
    expect(result.ok).toBe(true);
    expect(result.displayIndex).toBe(2);
    expect(result.resolvedTaskId).toBe("task_1b");
    const tasks = (session.latestDraft as { tasks: Array<{ id: string; timeNode?: { dueAt?: string } }> }).tasks;
    expect(tasks[1]!.timeNode?.dueAt).toBe("2026-05-28");
    expect(tasks[2]!.timeNode?.dueAt).toBe("2026-06-12");
    const row = (session.latestAssignment as { assignments: Array<{ taskId: string; primary: { userId: string } }> })
      .assignments.find((a) => a.taskId === "task_1b");
    expect(row?.primary.userId).toBe("u-yang");
  });
});
