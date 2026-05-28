import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import { buildProgressDigestFacts } from "../../../src/agent/progress-digest/progress-digest-facts";
import { loadProgressDigestPolicy } from "../../../src/agent/progress-digest/progress-digest-policy";
import { resolveDigestDetailUrl } from "../../../src/agent/progress-digest/progress-digest-build";
import { previousCalendarDayRangeInTz } from "../../../src/agent/reminders/reminder-policy";

describe("progress-digest-facts", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "digest-facts-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PROGRESS_DIGEST_MODE = "full";
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.PROGRESS_DIGEST_MODE;
  });

  function seedTask(opts?: { managerUserId?: string; assigneeUserId?: string; accept?: boolean }) {
    const managerUserId = opts?.managerUserId ?? "mgr-1";
    const assigneeUserId = opts?.assigneeUserId ?? "emp-1";
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "facts-seed";
    const now = new Date().toISOString();
    const planId = "plan-facts-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: managerUserId,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "产线异常调查",
        tasks: [
          {
            id: "task-1",
            title: "排查日志",
            objective: "o",
            deliverables: "d",
            completionCriteria: "c",
            timeNode: { dueAt: "2026-12-31", checkpoints: [] },
            feedbackFrequency: "每日",
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task-1", primary: { userId: assigneeUserId, displayName: "E1" } }],
      },
    });
    const session = planSessionStore.loadByChatKeyHash(chatKeyHash)!;
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId,
      session,
      managerUserId,
      actorUserId: managerUserId,
    });
    const detail = store.getTaskDetail(planId)!;
    const subtaskId = detail.subtasks[0]!.subtaskId;
    if (opts?.accept !== false) {
      store.updateSubtaskStatus({ subtaskId, actorUserId: assigneeUserId, action: "accept" });
    }
    return { store, detail, subtaskId, assigneeUserId, managerUserId };
  }

  it("manager facts count waiting accept in summary; ASSIGNED shows in inProgress", () => {
    const { store, managerUserId, assigneeUserId } = seedTask({ accept: false });
    const policy = loadProgressDigestPolicy();
    const facts = buildProgressDigestFacts({
      taskStore: store,
      userId: managerUserId,
      audience: "manager",
      policy,
      detailUrl: resolveDigestDetailUrl("manager"),
      resolveName: (uid) => (uid === assigneeUserId ? "杨贺新" : undefined),
    });
    expect(facts.isBrief).toBe(false);
    expect(facts.core.summary.waitingAcceptCount).toBe(1);
    expect(facts.core.inProgress.length).toBeGreaterThan(0);
    expect(facts.core.inProgress[0]?.assigneeName).toBe("杨贺新");
    expect(facts.activityWindow.labelYmd).toBeTruthy();
  });

  it("employee facts bucket blocked into needsAttention", () => {
    const { store, subtaskId, assigneeUserId } = seedTask();
    store.updateSubtaskStatus({
      subtaskId,
      actorUserId: assigneeUserId,
      action: "progress",
      progressStatus: "BLOCKED",
      note: "缺料",
    });
    const policy = loadProgressDigestPolicy();
    const facts = buildProgressDigestFacts({
      taskStore: store,
      userId: assigneeUserId,
      audience: "employee",
      policy,
      detailUrl: resolveDigestDetailUrl("employee"),
    });
    expect(facts.core.summary.blockedCount).toBe(1);
    expect(facts.core.needsAttention[0]?.statusLabel).toBe("阻塞中");
  });

  it("recentUpdates use actionLabel not event_type", () => {
    const { store, detail, subtaskId, managerUserId, assigneeUserId } = seedTask();
    const now = new Date("2026-05-21T06:00:00.000Z");
    const window = previousCalendarDayRangeInTz(now, "Asia/Shanghai");
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: assigneeUserId,
      note: "已完成采样",
      occurredAt: new Date(new Date(window.sinceIso).getTime() + 3600_000).toISOString(),
    });
    const policy = loadProgressDigestPolicy();
    const facts = buildProgressDigestFacts({
      taskStore: store,
      userId: managerUserId,
      audience: "manager",
      policy,
      detailUrl: resolveDigestDetailUrl("manager"),
      now,
      resolveName: (uid) => (uid === assigneeUserId ? "杨贺新" : undefined),
    });
    expect(facts.core.recentUpdates[0]?.actionLabel).toBe("提交进度");
    expect(facts.core.recentUpdates[0]?.actorName).toBe("杨贺新");
    expect(JSON.stringify(facts.core.recentUpdates)).not.toContain("SUBTASK_PROGRESS");
  });

  it("excludes events outside previous calendar day window", () => {
    const { store, detail, subtaskId, managerUserId, assigneeUserId } = seedTask();
    const now = new Date("2026-05-21T06:00:00.000Z");
    const window = previousCalendarDayRangeInTz(now, "Asia/Shanghai");
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: assigneeUserId,
      note: "昨日事件",
      occurredAt: new Date(new Date(window.sinceIso).getTime() + 3600_000).toISOString(),
    });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: assigneeUserId,
      note: "今日事件",
      occurredAt: window.untilIso,
    });
    const policy = loadProgressDigestPolicy();
    const facts = buildProgressDigestFacts({
      taskStore: store,
      userId: managerUserId,
      audience: "manager",
      policy,
      detailUrl: resolveDigestDetailUrl("manager"),
      now,
    });
    expect(facts.core.recentUpdates).toHaveLength(1);
    expect(facts.core.recentUpdates[0]?.note).toBe("昨日事件");
  });
});
