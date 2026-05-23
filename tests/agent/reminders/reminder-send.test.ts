import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import { createPeopleDirectoryStore } from "../../../src/infra/people-directory-store";
import { sendManagerOverdueAlert, sendPreDueEmployeeReminder } from "../../../src/agent/reminders/reminder-send";
import { loadReminderPolicy } from "../../../src/agent/reminders/reminder-policy";
import type { WorkbenchPublishNotifier } from "../../../src/integrations/dingtalk/workbench-notify";

describe("reminder-send", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "reminder-send-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
  });

  function seedSubtask(dueAt: string) {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "send-seed";
    const now = new Date().toISOString();
    const planId = "plan-send-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: "mgr-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "Send task",
        tasks: [
          {
            id: "task-1",
            title: "Sub",
            objective: "o",
            deliverables: "d",
            completionCriteria: "c",
            timeNode: { dueAt, checkpoints: [] },
            feedbackFrequency: "每日",
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task-1", primary: { userId: "emp-1", displayName: "E1" } }],
      },
    });
    const session = planSessionStore.loadByChatKeyHash(chatKeyHash)!;
    const taskStore = createWorkbenchFormalTaskStore();
    taskStore.publishFromSession({
      planId,
      session,
      managerUserId: "mgr-1",
      actorUserId: "mgr-1",
    });
    const sid = taskStore.getTaskDetail(planId)!.subtasks[0]!.subtaskId;
    taskStore.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-1", action: "accept" });
    const peopleStore = createPeopleDirectoryStore();
    peopleStore.upsertContact({
      userId: "emp-1",
      name: "E1",
      active: true,
      lastSyncedAt: now,
    });
    peopleStore.upsertContact({
      userId: "mgr-1",
      name: "Mgr",
      active: true,
      lastSyncedAt: now,
    });
    return { taskStore, peopleStore, sid };
  }

  const mockNotifier: WorkbenchPublishNotifier = {
    notifyPublishedTask: async () => ({ enabled: true, success: [], failed: [] }),
    notifyReassignedAssignee: async () => ({ enabled: true, success: [], failed: [] }),
    notifyTaskStopped: async () => ({ enabled: true, success: [], failed: [] }),
    notifyManagerOfEmployeeAction: async () => ({ enabled: true, success: [], failed: [] }),
    notifyEmployeeOfManagerAction: async () => ({ enabled: true, success: [], failed: [] }),
    notifySubtaskReminder: async () => ({
      enabled: true,
      success: [{ robotMessageKey: "mock-robot" }],
      failed: [],
    }),
    notifyManagerSubtaskOverdue: async () => ({
      enabled: true,
      success: [{ robotMessageKey: "mock-mgr" }],
      failed: [],
    }),
    notifyProgressDigest: async () => ({ enabled: true, success: [], failed: [] }),
    notifyEmployeeTodoOnAccept: async () => ({ enabled: true }),
  };

  it("sendPreDueEmployeeReminder skips duplicate same-day claim", async () => {
    const { taskStore, peopleStore, sid } = seedSubtask("2026-05-22");
    const policy = loadReminderPolicy();
    const deps = { taskStore, peopleStore, notifier: mockNotifier, policy };
    const now = new Date("2026-05-21T02:02:00.000Z");

    const first = await sendPreDueEmployeeReminder(sid, deps);
    expect(first.ok).toBe(true);

    const second = await sendPreDueEmployeeReminder(sid, deps);
    expect(second.ok).toBe(false);
    expect(second.skipped).toBeTruthy();
    void now;
  });

  it("sendManagerOverdueAlert skips duplicate overdue episode", async () => {
    const { taskStore, peopleStore, sid } = seedSubtask("2026-05-20");
    const policy = loadReminderPolicy();
    const deps = { taskStore, peopleStore, notifier: mockNotifier, policy };
    const overdueSince = "2026-05-20T10:00:00.000Z";

    const first = await sendManagerOverdueAlert({ subtaskId: sid, overdueSince }, deps);
    expect(first.ok).toBe(true);

    const second = await sendManagerOverdueAlert({ subtaskId: sid, overdueSince }, deps);
    expect(second.ok).toBe(false);
    expect(second.skipped).toBeTruthy();
  });
});
