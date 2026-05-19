import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import {
  listFollowUpCandidatesForActor,
  listSchedulerEligibleReminders,
} from "../../../src/agent/reminders/reminder-eligibility";
import { loadReminderPolicy } from "../../../src/agent/reminders/reminder-policy";

describe("reminder-eligibility", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "reminder-elig-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.FOLLOWUP_REMINDER_ENABLED = "1";
    process.env.FOLLOWUP_QUIET_HOURS = "";
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.FOLLOWUP_REMINDER_ENABLED;
    delete process.env.FOLLOWUP_QUIET_HOURS;
  });

  function seedPublishedOverdue() {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "reminder-seed";
    const now = new Date().toISOString();
    const planId = "plan-reminder-1";
    const pastDue = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: "mgr-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "Reminder task",
        description: "desc",
        tasks: [
          {
            id: "task-1",
            title: "Overdue sub",
            objective: "o",
            deliverables: "d",
            completionCriteria: "c",
            timeNode: { dueAt: pastDue, checkpoints: [] },
            feedbackFrequency: "每日",
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task-1", primary: { userId: "emp-1", displayName: "E1" } }],
      },
    });
    const session = planSessionStore.loadByChatKeyHash(chatKeyHash)!;
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId,
      session,
      managerUserId: "mgr-1",
      actorUserId: "mgr-1",
    });
    const detail = store.getTaskDetail(planId)!;
    const sid = detail.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-1", action: "accept" });
    return { store, sid, detail };
  }

  it("lists overdue IN_PROGRESS for scheduler", () => {
    const { store } = seedPublishedOverdue();
    const eligible = listSchedulerEligibleReminders(
      store,
      new Date("2026-05-20T12:00:00.000Z"),
      loadReminderPolicy(),
    );
    expect(eligible.length).toBeGreaterThanOrEqual(1);
    expect(["day1", "day2plus"]).toContain(eligible[0]?.tier);
  });

  it("listFollowUpCandidates filters by manager", () => {
    const { store } = seedPublishedOverdue();
    const mgr = listFollowUpCandidatesForActor(store, "mgr-1", { bucket: "overdue" });
    expect(mgr.length).toBeGreaterThanOrEqual(1);
    const other = listFollowUpCandidatesForActor(store, "other-mgr", { bucket: "overdue" });
    expect(other.length).toBe(0);
  });
});
