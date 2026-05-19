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
    ...overrides,
  };
}

describe("prepare_publish_task tool", () => {
  it("returns missing assignee hint instead of throwing", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      planId: "plan-1",
      title: "测试发布",
      description: "任务整体背景说明",
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
      description: "背景",
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
      description: "面向员工的任务背景：排查 U 盘兼容性问题并修复。",
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
    expect(draft?.description).toBe("面向员工的任务背景：排查 U 盘兼容性问题并修复。");
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
            collaborators: ["协作A"],
            scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
            dependencyTaskIds: ["task_0"],
            risksAndOpenQuestions: ["风险A"],
            feedbackFrequency: "每日",
            timeNode: { dueAt: "2026-05-18", checkpoints: ["检查点A"] },
          },
        ],
        classification: { domain: "QUALITY", subtype: "QUALITY_OTHER_OR_UNCERTAIN" },
      },
    });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-1",
      title: "新标题",
      description: "新背景",
      subtasks: [
        {
          taskId: "task_1",
          title: "新任务1",
          assigneeUserId: "emp-1",
          objective: "新目标",
          dueAt: "2026-06-01",
        },
      ],
    }) as any;
    expect(result.ok).toBe(true);
    const draft = session.latestDraft as Record<string, unknown>;
    expect(draft.title).toBe("新标题");
    expect(draft.description).toBe("新背景");
    expect(draft.classification).toMatchObject({ domain: "QUALITY" });
    const task = ((draft.tasks as Array<Record<string, unknown>>)[0]);
    expect(task).toMatchObject({
      id: "task_1",
      title: "新任务1",
      objective: "新目标",
      deliverables: ["交付物A"],
      completionCriteria: ["标准A"],
      inputMaterials: ["输入A"],
      actions: ["动作A"],
      collaborators: ["协作A"],
      scope: { inScope: ["范围内A"], outOfScope: ["范围外A"] },
      dependencyTaskIds: ["task_0"],
      risksAndOpenQuestions: ["风险A"],
      feedbackFrequency: "每日",
      timeNode: { dueAt: "2026-06-01", checkpoints: ["检查点A"] },
    });
  });

  it("rejects plan mismatch instead of mutating session", () => {
    const session = makeSession({ planId: "plan-real" });
    const handler = buildPreparePublishTaskHandler({ currentSession: session });
    const result = handler({
      planId: "plan-wrong",
      title: "测试",
      description: "背景",
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
      description: "背景",
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

  it("rejects unknown_assignees when getContact is provided and a userId is fabricated", () => {
    const session = makeSession();
    const knownContacts = new Map<string, { active: boolean; unionId?: string }>([
      ["641728622", { active: true, unionId: "uni-yang" }],
    ]);
    const handler = buildPreparePublishTaskHandler({
      currentSession: session,
      getContact: (userId) => knownContacts.get(userId),
    });
    const result = handler({
      planId: "plan-1",
      title: "测试发布",
      description: "背景",
      subtasks: [
        { taskId: "task_1", title: "任务A", assigneeUserId: "641728622" },
        { taskId: "task_2", title: "任务B", assigneeUserId: "u_yanghexin" },
      ],
    }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_assignees");
    expect(result.unknown).toEqual([
      { taskId: "task_2", assigneeUserId: "u_yanghexin" },
    ]);
    expect(String(result.hint)).toContain("禁止编造 userId");
    // CRITICAL: session must NOT be polluted when validation fails
    expect(session.latestDraft).toBeUndefined();
    expect(session.latestAssignment).toBeUndefined();
  });

  it("treats inactive contact as unknown (e.g. departed employee)", () => {
    const handler = buildPreparePublishTaskHandler({
      getContact: (userId) =>
        userId === "641728622" ? { active: false } : undefined,
    });
    const result = handler({
      planId: "plan-1",
      title: "测试发布",
      description: "背景",
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "641728622" }],
    }) as any;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_assignees");
  });

  it("returns missing_description when description empty", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      planId: "plan-1",
      title: "测试",
      description: "   ",
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "emp-1" }],
    }) as any;
    expect(result).toMatchObject({ ok: false, reason: "missing_description" });
  });

  it("returns description_too_long when description exceeds cap", () => {
    const handler = buildPreparePublishTaskHandler();
    const result = handler({
      planId: "plan-1",
      title: "测试",
      description: "x".repeat(TASK_DESCRIPTION_MAX_DB + 1),
      subtasks: [{ taskId: "t1", title: "任务1", assigneeUserId: "emp-1" }],
    }) as any;
    expect(result).toMatchObject({ ok: false, reason: "description_too_long" });
  });
});
