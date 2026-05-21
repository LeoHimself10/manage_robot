import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../src/infra/plan-session-store";
import { startOfDayInTz } from "../../src/agent/reminders/reminder-policy";

describe("workbench-formal-task-store progress digest", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "progress-digest-store-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
  });

  function seedTask(managerUserId = "mgr-1", assigneeUserId = "emp-1") {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "digest-seed";
    const now = new Date().toISOString();
    const planId = "plan-digest-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: managerUserId,
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "Digest task",
        tasks: [
          {
            id: "task-1",
            title: "子任务标题",
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
    return { store, detail, subtaskId: detail.subtasks[0]!.subtaskId, taskId: detail.task.taskId };
  }

  it("lists distinct manager and employee user ids", () => {
    const { store } = seedTask();
    expect(store.listProgressDigestManagerUserIds()).toEqual(["mgr-1"]);
    expect(store.listProgressDigestEmployeeUserIds()).toEqual(["emp-1"]);
  });

  it("detects active manager tasks and employee subtasks", () => {
    const { store, subtaskId } = seedTask();
    expect(store.hasActiveTasksAsManager("mgr-1")).toBe(true);
    expect(store.hasActiveSubtasksAsEmployee("emp-1")).toBe(true);
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "DONE" });
    expect(store.hasActiveSubtasksAsEmployee("emp-1")).toBe(false);
    expect(store.hasActiveTasksAsManager("mgr-1")).toBe(false);
  });

  it("lists manager events since timestamp", () => {
    const { store, subtaskId, taskId } = seedTask();
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "accept" });
    store.appendTaskEvent({
      taskId,
      subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "emp-1",
      note: "完成第一步",
      occurredAt: new Date().toISOString(),
    });
    const since = new Date(Date.now() - 60_000).toISOString();
    const events = store.listTaskEventsForManagerSince({
      managerUserId: "mgr-1",
      sinceIso: since,
      eventTypes: ["SUBTASK_PROGRESS", "SUBTASK_ACCEPTED"],
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.event_type === "SUBTASK_PROGRESS")).toBe(true);
  });

  it("tryClaimProgressDigest allows once per user per day", () => {
    const store = createWorkbenchFormalTaskStore();
    const now = new Date("2026-05-18T01:00:00.000Z");
    const todayStart = startOfDayInTz(now, "Asia/Shanghai");
    const first = store.tryClaimProgressDigest({
      userId: "mgr-1",
      audience: "manager",
      nowIso: now.toISOString(),
      todayStartIso: todayStart,
      sourceId: "progress:digest:mgr-1:manager:20260518",
    });
    expect(first.claimed).toBe(true);
    const second = store.tryClaimProgressDigest({
      userId: "mgr-1",
      audience: "manager",
      nowIso: new Date(now.getTime() + 60_000).toISOString(),
      todayStartIso: todayStart,
      sourceId: "progress:digest:mgr-1:manager:20260518",
    });
    expect(second.claimed).toBe(false);
  });
});
