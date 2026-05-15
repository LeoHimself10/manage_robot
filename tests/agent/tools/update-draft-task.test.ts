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

  it("fails when subtaskId not found", () => {
    const handler = buildUpdateDraftTaskHandler({ currentSession: makeSessionWithDraft() });
    const result = handler({ subtaskId: "task_99", patch: { title: "x" } }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("subtask_not_found");
    expect(String(result.hint)).toContain("task_1");
  });

  it("requires non-empty patch", () => {
    const handler = buildUpdateDraftTaskHandler({ currentSession: makeSessionWithDraft() });
    const result = handler({ subtaskId: "task_1", patch: {} }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("empty_patch");
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
    expect(result.updatedFields).toEqual(["title", "objective", "dueAt"]);

    const tasks = (session.latestDraft as any).tasks;
    expect(tasks[0].title).toBe("紧急全检 (改后)");
    expect(tasks[0].objective).toBe("对 KT 批次 100% 检测");
    expect(tasks[0].timeNode.dueAt).toBe("2026-05-16 12:00");
  });

  it("validates assigneeUserId against contacts when getContact provided", () => {
    const session = makeSessionWithDraft();
    const handler = buildUpdateDraftTaskHandler({
      currentSession: session,
      getContact: (uid) => (uid === "641872345" ? { active: true, unionId: "u1" } : undefined),
    });
    const bad = handler({ subtaskId: "task_1", patch: { assigneeUserId: "u_fake" } }) as any;
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("unknown_assignee");

    const good = handler({ subtaskId: "task_1", patch: { assigneeUserId: "641872345" } }) as any;
    expect(good.ok).toBe(true);
    const assignments = (session.latestAssignment as any).assignments;
    expect(assignments.find((a: any) => a.taskId === "task_1").primary.userId).toBe("641872345");
  });

  it("creates assignment row if missing for the target subtask", () => {
    const session = makeSessionWithDraft();
    (session.latestAssignment as any).assignments = [];
    const handler = buildUpdateDraftTaskHandler({
      currentSession: session,
      getContact: () => ({ active: true }),
    });
    const result = handler({
      subtaskId: "task_1",
      patch: { assigneeUserId: "641000001" },
    }) as any;
    expect(result.ok).toBe(true);
    const assignments = (session.latestAssignment as any).assignments;
    expect(assignments).toHaveLength(1);
    expect(assignments[0].taskId).toBe("task_1");
    expect(assignments[0].primary.userId).toBe("641000001");
  });

  it("updates dependencyTaskIds checkpoints and risks (replace arrays)", () => {
    const session = makeSessionWithDraft();
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const r = handler({
      subtaskId: "task_1",
      patch: {
        dependencyTaskIds: ["task_2"],
        checkpoints: ["M0"],
        risks: ["缺样"],
      },
    }) as any;
    expect(r.ok).toBe(true);
    expect(r.updatedFields).toEqual(expect.arrayContaining(["dependencyTaskIds", "checkpoints", "risksAndOpenQuestions"]));
    const t = (session.latestDraft as any).tasks[0];
    expect(t.dependencyTaskIds).toEqual(["task_2"]);
    expect(t.timeNode.checkpoints).toEqual(["M0"]);
    expect(t.risksAndOpenQuestions).toEqual(["缺样"]);
  });

  it("updates inputMaterials actions collaborators", () => {
    const session = makeSessionWithDraft();
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const r = handler({
      subtaskId: "task_1",
      patch: {
        inputMaterials: ["图纸"],
        actions: ["分析"],
        collaborators: ["李四"],
      },
    }) as any;
    expect(r.ok).toBe(true);
    const t = (session.latestDraft as any).tasks[0];
    expect(t.inputMaterials).toEqual(["图纸"]);
    expect(t.actions).toEqual(["分析"]);
    expect(t.collaborators).toEqual(["李四"]);
  });

  it("merges scope partially when only outOfScope provided", () => {
    const session = makeSessionWithDraft();
    (session.latestDraft as any).tasks[0].scope = { inScope: ["A"], outOfScope: ["旧"] };
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const r = handler({
      subtaskId: "task_1",
      patch: { scope: { outOfScope: ["不做包装"] } },
    }) as any;
    expect(r.ok).toBe(true);
    const t = (session.latestDraft as any).tasks[0];
    expect(t.scope.inScope).toEqual(["A"]);
    expect(t.scope.outOfScope).toEqual(["不做包装"]);
  });

  it("replaces scope inScope when provided", () => {
    const session = makeSessionWithDraft();
    (session.latestDraft as any).tasks[0].scope = { inScope: ["A"], outOfScope: ["B"] };
    const handler = buildUpdateDraftTaskHandler({ currentSession: session });
    const r = handler({
      subtaskId: "task_1",
      patch: { scope: { inScope: ["X"] } },
    }) as any;
    expect(r.ok).toBe(true);
    const t = (session.latestDraft as any).tasks[0];
    expect(t.scope.inScope).toEqual(["X"]);
    expect(t.scope.outOfScope).toEqual(["B"]);
  });
});
