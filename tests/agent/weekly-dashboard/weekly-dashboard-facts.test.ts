import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanSessionStore, type PlanSession } from "../../../src/infra/plan-session-store";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { buildWeeklyDashboardFacts } from "../../../src/agent/weekly-dashboard/weekly-dashboard-facts";
import { buildWeeklyDashboardTimeline } from "../../../src/agent/weekly-dashboard/weekly-dashboard-timeline";

describe("weekly dashboard facts", () => {
  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "weekly-dashboard-"));
    process.env.WORKBENCH_SQLITE_PATH = join(tmp, "workbench.sqlite");
    process.env.PLAN_SESSION_DIR = join(tmp, "sessions");
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
  });

  function seedTask(input: {
    planId: string;
    managerUserId?: string;
    assigneeUserId?: string;
    dueAt?: string;
    title?: string;
  }) {
    const managerUserId = input.managerUserId ?? "manager-1";
    const assigneeUserId = input.assigneeUserId ?? "emp-1";
    const now = "2026-05-19T02:00:00.000Z";
    const session: PlanSession = {
      chatKeyHash: `chat-${input.planId}`,
      planId: input.planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: managerUserId,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: input.title ?? "周会任务",
        tasks: [
          {
            id: "task-1",
            title: input.title ?? "完成验证",
            objective: "o",
            deliverables: "d",
            completionCriteria: "c",
            timeNode: { dueAt: input.dueAt ?? "2026-05-20", checkpoints: [] },
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task-1", primary: { userId: assigneeUserId, displayName: assigneeUserId } }],
      },
    };
    const sessionStore = createPlanSessionStore();
    sessionStore.save(session);
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId: input.planId,
      session,
      managerUserId,
      initiatorDepartment: "测试部",
      actorUserId: managerUserId,
    });
    const detail = store.getTaskDetail(input.planId)!;
    return { store, detail };
  }

  it("builds current-week scope, KPIs, task gantt bars, and person badges", () => {
    const { store, detail } = seedTask({ planId: "plan-weekly-1" });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: detail.subtasks[0]!.subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "emp-1",
      payload: { progressStatus: "DONE" },
      occurredAt: "2026-05-20T03:00:00.000Z",
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: detail.subtasks[0]!.subtaskId,
      eventType: "SUBTASK_CUSTOMIZE_NOTE",
      actorUserId: "emp-1",
      note: "补充说明",
      occurredAt: "2026-05-20T04:00:00.000Z",
    });

    const facts = buildWeeklyDashboardFacts({
      taskStore: store,
      managerUserId: "manager-1",
      week: "2026-05-20",
      span: 1,
      now: new Date("2026-05-20T04:00:00.000Z"),
      policy: {
        timezone: "Asia/Shanghai",
        defaultSpan: 1,
        maxSpan: 6,
        feedPageSize: 1,
        feedMaxPageSize: 100,
        advisorLlmEnabled: false,
        advisorLlmModel: "test",
        advisorLlmTimeoutMs: 10,
        advisorLlmMaxTokens: 100,
        advisorLlmBaseUrl: "http://example.test",
        advisorLlmApiKey: "",
      },
      feedLimit: 1,
    });

    expect(facts.week.mondayYmd).toBe("2026-05-18");
    expect(facts.approxHistoricalState).toBe(false);
    expect(facts.tasks).toHaveLength(1);
    expect(facts.kpi.completedInWeek).toBe(1);
    expect(facts.kpi.waitingAccept).toBe(0);
    expect(facts.kpi.eventCount).toBeGreaterThanOrEqual(2);
    expect(facts.feed.nextCursor).toBe("offset:1");

    const timeline = buildWeeklyDashboardTimeline({ facts });
    expect(timeline.byTask[0]?.bars[0]?.dueYmd).toBe("2026-05-20");
    expect(timeline.byTask[0]?.bars[0]?.isOverdue).toBe(false);
    expect(timeline.byPerson[0]?.dueInSpanCount).toBe(1);
  });

  it("includes historical tasks by due span even without center-week events", () => {
    const { store } = seedTask({ planId: "plan-weekly-2", dueAt: "2026-05-28" });
    const facts = buildWeeklyDashboardFacts({
      taskStore: store,
      managerUserId: "manager-1",
      week: "2026-05-20",
      span: 1,
      now: new Date("2026-06-10T04:00:00.000Z"),
      policy: {
        timezone: "Asia/Shanghai",
        defaultSpan: 1,
        maxSpan: 6,
        feedPageSize: 50,
        feedMaxPageSize: 100,
        advisorLlmEnabled: false,
        advisorLlmModel: "test",
        advisorLlmTimeoutMs: 10,
        advisorLlmMaxTokens: 100,
        advisorLlmBaseUrl: "http://example.test",
        advisorLlmApiKey: "",
      },
    });
    expect(facts.approxHistoricalState).toBe(true);
    expect(facts.tasks.map((g) => g.task.planId)).toContain("plan-weekly-2");
  });

  it("excludes non-dashboard event types from feed count", () => {
    const { store, detail } = seedTask({ planId: "plan-weekly-events" });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: detail.subtasks[0]!.subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "emp-1",
      payload: { progressStatus: "IN_PROGRESS" },
      occurredAt: "2026-05-20T03:00:00.000Z",
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId: detail.subtasks[0]!.subtaskId,
      eventType: "EMPLOYEE_NOTIFY_FAILED",
      actorUserId: "system",
      note: "notify failed",
      occurredAt: "2026-05-20T04:00:00.000Z",
    });
    const facts = buildWeeklyDashboardFacts({
      taskStore: store,
      managerUserId: "manager-1",
      week: "2026-05-20",
      span: 1,
      now: new Date("2026-05-20T04:00:00.000Z"),
      policy: {
        timezone: "Asia/Shanghai",
        defaultSpan: 1,
        maxSpan: 6,
        feedPageSize: 50,
        feedMaxPageSize: 100,
        advisorLlmEnabled: false,
        advisorLlmModel: "test",
        advisorLlmTimeoutMs: 10,
        advisorLlmMaxTokens: 100,
        advisorLlmBaseUrl: "http://example.test",
        advisorLlmApiKey: "",
      },
    });
    expect(facts.kpi.eventCount).toBe(1);
    expect(facts.feed.items.every((e) => e.eventType !== "EMPLOYEE_NOTIFY_FAILED")).toBe(true);
  });

  it("scopes tasks by projectId when provided", () => {
    const store = createWorkbenchFormalTaskStore();
    seedTask({ planId: "plan-a", managerUserId: "manager-1" });
    const project = store.createProject({
      ownerUserId: "manager-1",
      name: "专项 A",
    });
    store.setTaskProject({
      taskNo: store.getTaskDetail("plan-a")!.task.taskNo,
      projectId: project.projectId,
      managerUserId: "manager-1",
    });
    seedTask({ planId: "plan-b", managerUserId: "manager-1" });
    const facts = buildWeeklyDashboardFacts({
      taskStore: store,
      managerUserId: "manager-1",
      week: "2026-05-20",
      span: 1,
      now: new Date("2026-05-20T04:00:00.000Z"),
      projectId: project.projectId,
      policy: {
        timezone: "Asia/Shanghai",
        defaultSpan: 1,
        maxSpan: 6,
        feedPageSize: 50,
        feedMaxPageSize: 100,
        advisorLlmEnabled: false,
        advisorLlmModel: "test",
        advisorLlmTimeoutMs: 10,
        advisorLlmMaxTokens: 100,
        advisorLlmBaseUrl: "http://example.test",
        advisorLlmApiKey: "",
      },
    });
    expect(facts.tasks.map((g) => g.task.planId)).toEqual(["plan-a"]);
  });
});
