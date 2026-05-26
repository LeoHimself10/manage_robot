import { describe, expect, it } from "vitest";
import { buildPreparePublishTaskHandler } from "../../../src/agent/tools/prepare-publish-task";
import { TASK_DESCRIPTION_MAX_DB } from "../../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../../src/infra/plan-session-store";

function makeSession(overrides: Partial<PlanSession> = {}): PlanSession {
  return {
    chatKeyHash: "hash-1",
    planId: "plan-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: "测试发布",
      description: "任务整体背景说明",
      tasks: [{ id: "task_1", title: "任务1", objective: "目标1" }],
    },
    latestAssignment: {
      assignments: [{ taskId: "task_1", primary: { userId: "emp-1", displayName: "张三" }, confidence: "HIGH" }],
    },
    ...overrides,
  };
}

describe("prepare_publish_task tool", () => {
  it("blocks prepare when search_employees quota exhausted this turn", () => {
    const handler = buildPreparePublishTaskHandler({
      searchEmployeesQuotaExhausted: () => true,
      currentSession: makeSession(),
    });
    const result = handler({ planId: "plan-1" }) as { ok: boolean; reason?: string };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("search_employees_quota_exhausted");
  });

  it("returns missing assignee when latestAssignment incomplete", () => {
    const session = makeSession({
      latestAssignment: { assignments: [{ taskId: "task_1", primary: {}, confidence: "HIGH" }] },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-1" }) as any;
    expect(result).toMatchObject({ ok: false, reason: "missing_assignee" });
  });

  it("prepares publish payload from session when assignees exist", () => {
    const handler = buildPreparePublishTaskHandler({ currentSession: makeSession() });
    const result = handler({ planId: "plan-1" }) as any;
    expect(result.ok).toBe(true);
    expect(result.requiresManagerConfirm).toBe(true);
    expect(result.subtasks).toHaveLength(1);
  });

  it("stages draft + assignment into provided session on success", () => {
    const session = makeSession();
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-1",
      title: "U盘兼容性故障排查与修复",
      description: "面向员工的任务背景：排查 U 盘兼容性问题并修复。",
    }) as any;

    expect(result.ok).toBe(true);
    expect(result.staged).toBe(true);
    const draft = session.latestDraft as Record<string, unknown> | undefined;
    expect(draft?.title).toBe("U盘兼容性故障排查与修复");
    expect(draft?.stagedBy).toBe("prepare_publish_task");
    expect(draft?.stagedDraftHash).toBeTruthy();
    const tasks = (draft?.tasks ?? []) as Array<Record<string, unknown>>;
    expect(tasks[0]).toMatchObject({ id: "task_1", title: "任务1" });
    expect(tasks[0].assigneeUserId).toBeUndefined();
    const assignment = session.latestAssignment as Record<string, unknown> | undefined;
    const assignments = (assignment?.assignments ?? []) as Array<Record<string, unknown>>;
    expect(assignments[0]).toMatchObject({
      taskId: "task_1",
      primary: { userId: "emp-1", displayName: "张三" },
    });
  });

  it("fills displayName from search hit when assignment row lacks it", () => {
    const now = new Date().toISOString();
    const session = makeSession({
      lastEmployeeSearchHits: [{ userId: "emp-1", displayName: "张三", hitAt: now }],
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-1" }, confidence: "HIGH" }],
      },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-1" }) as { ok: boolean };
    expect(result.ok).toBe(true);
    const assignments = (session.latestAssignment as { assignments: Array<{ primary: Record<string, unknown> }> })
      .assignments;
    expect(assignments[0]?.primary.displayName).toBe("张三");
  });

  it("fills displayName from getContact when assignment and search hit lack it", () => {
    const session = makeSession({
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-1" }, confidence: "HIGH" }],
      },
    });
    const handler = buildPreparePublishTaskHandler({
      currentSession: session,
      getContact: (userId) =>
        userId === "emp-1" ? { active: true, name: "通讯录张三" } : undefined,
    });
    const result = handler({ planId: "plan-1" }) as { ok: boolean };
    expect(result.ok).toBe(true);
    const assignments = (session.latestAssignment as { assignments: Array<{ primary: Record<string, unknown> }> })
      .assignments;
    expect(assignments[0]?.primary.displayName).toBe("通讯录张三");
  });

  it("preserves rich task fields when staging from existing latestDraft", () => {
    const session = makeSession({
      latestDraft: {
        title: "旧标题",
        description: "旧背景",
        tasks: [
          {
            id: "task_1",
            title: "旧任务1",
            objective: "旧目标",
            deliverables: ["交付物A"],
            completionCriteria: ["标准A"],
            inputMaterials: ["输入A"],
            actions: ["动作A"],
            scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
            dependencyTaskIds: ["task_0"],
            risksAndOpenQuestions: ["风险A"],
            feedbackFrequency: "每日",
            timeNode: { dueAt: "2026-05-18", checkpoints: ["检查点A"] },
          },
        ],
      },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-1", title: "新标题", description: "新背景" }) as any;
    expect(result.ok).toBe(true);
    const draft = session.latestDraft as Record<string, unknown>;
    const task = (draft.tasks as Array<Record<string, unknown>>)[0];
    expect(task).toMatchObject({
      deliverables: ["交付物A"],
      inputMaterials: ["输入A"],
      actions: ["动作A"],
      scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
    });
    expect(task.collaborators).toBeUndefined();
  });

  it("rejects plan mismatch instead of mutating session", () => {
    const session = makeSession({ planId: "plan-real" });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-wrong" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("plan_mismatch");
    expect((session.latestDraft as any)?.stagedBy).toBeUndefined();
  });

  it("returns already_staged when content unchanged", () => {
    const session = makeSession();
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const first = handler({ planId: "plan-1" }) as any;
    expect(first.ok).toBe(true);
    const second = handler({ planId: "plan-1" }) as any;
    expect(second.ok).toBe(true);
    expect(second.reason).toBe("already_staged");
  });

  it("rejects unknown_assignees when getContact is provided and a userId is fabricated", () => {
    const session = makeSession({
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "641728622" }, confidence: "HIGH" },
        ],
      },
    });
    const knownContacts = new Map<string, { active: boolean; unionId?: string }>([
      ["641728622", { active: true, unionId: "uni-yang" }],
    ]);
    const handler = buildPreparePublishTaskHandler({
      currentSession: session,
      getContact: (userId) => knownContacts.get(userId),
    });
    const badSession = makeSession({
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "u_yanghexin" }, confidence: "HIGH" },
        ],
      },
    });
    const badHandler = buildPreparePublishTaskHandler({
      currentSession: badSession,
      getContact: (userId) => knownContacts.get(userId),
    });
    const result = badHandler({ planId: "plan-1" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_assignees");
    expect((badSession.latestDraft as any)?.stagedBy).toBeUndefined();
  });

  it("returns missing_description when description empty", () => {
    const session = makeSession({
      latestDraft: { title: "测试", tasks: [{ id: "task_1", title: "任务1" }] },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-1" }, confidence: "HIGH" }],
      },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-1", title: "测试" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_description");
  });

  it("returns description_too_long when over limit", () => {
    const session = makeSession({
      latestDraft: {
        title: "测试",
        description: "x".repeat(TASK_DESCRIPTION_MAX_DB + 1),
        tasks: [{ id: "task_1", title: "任务1" }],
      },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({ planId: "plan-1" }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("description_too_long");
  });
});
