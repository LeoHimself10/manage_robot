import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import {
  listFollowUpCandidatesForActor,
  listManagerOverdueAlerts,
  listPreDueEmployeeReminders,
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
    process.env.FOLLOWUP_WEEKDAYS_ONLY = "1";
    process.env.FOLLOWUP_PRE_DUE_HOUR = "10";
    process.env.FOLLOWUP_PRE_DUE_MINUTE = "0";
    process.env.FOLLOWUP_SCAN_INTERVAL_MS = "300000";
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.FOLLOWUP_REMINDER_ENABLED;
    delete process.env.FOLLOWUP_QUIET_HOURS;
    delete process.env.FOLLOWUP_WEEKDAYS_ONLY;
    delete process.env.FOLLOWUP_PRE_DUE_HOUR;
    delete process.env.FOLLOWUP_PRE_DUE_MINUTE;
    delete process.env.FOLLOWUP_SCAN_INTERVAL_MS;
  });

  function seedPublishedWithDue(
    dueAt: string,
    opts: { planId?: string; managerUserId?: string; managerGroupId?: string; assigneeUserId?: string } = {},
  ) {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = `reminder-seed-${opts.planId ?? "default"}`;
    const now = new Date().toISOString();
    const planId = opts.planId ?? "plan-reminder-1";
    const managerUserId = opts.managerUserId ?? "mgr-1";
    const assigneeUserId = opts.assigneeUserId ?? "emp-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: managerUserId,
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
            timeNode: { dueAt, checkpoints: [] },
            feedbackFrequency: "每日",
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task-1", primary: { userId: assigneeUserId, displayName: assigneeUserId } }],
      },
    });
    const session = planSessionStore.loadByChatKeyHash(chatKeyHash)!;
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId,
      session,
      managerUserId,
      managerGroupId: opts.managerGroupId,
      actorUserId: managerUserId,
    });
    const detail = store.getTaskDetail(planId)!;
    const sid = detail.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: assigneeUserId, action: "accept" });
    return { store, sid, detail };
  }

  it("lists pre-due reminders on T-1 at 10:00 Beijing window", () => {
    const { store } = seedPublishedWithDue("2026-05-22");
    const policy = loadReminderPolicy();
    const eligible = listPreDueEmployeeReminders(
      store,
      new Date("2026-05-21T02:02:00.000Z"),
      policy,
    );
    expect(eligible.length).toBe(1);
    expect(eligible[0]?.assigneeUserId).toBe("emp-1");
  });

  it("skips pre-due on weekends", () => {
    const { store } = seedPublishedWithDue("2026-05-25");
    const policy = loadReminderPolicy();
    const eligible = listPreDueEmployeeReminders(
      store,
      new Date("2026-05-24T02:02:00.000Z"),
      policy,
    );
    expect(eligible.length).toBe(0);
  });

  it("lists manager overdue alerts after due instant", () => {
    const { store } = seedPublishedWithDue("2026-05-20");
    const eligible = listManagerOverdueAlerts(
      store,
      new Date("2026-05-21T12:00:00.000Z"),
      loadReminderPolicy(),
    );
    expect(eligible.length).toBeGreaterThanOrEqual(1);
    expect(eligible[0]?.managerUserId).toBe("mgr-1");
  });

  it("listFollowUpCandidates filters by manager", () => {
    const { store } = seedPublishedWithDue("2026-05-20");
    const mgr = listFollowUpCandidatesForActor(store, "mgr-1", {
      bucket: "overdue",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });
    expect(mgr.length).toBeGreaterThanOrEqual(1);
    const other = listFollowUpCandidatesForActor(store, "other-mgr", { bucket: "overdue" });
    expect(other.length).toBe(0);
  });

  it("listFollowUpCandidates keeps own ungrouped tasks after joining a manager group", () => {
    const { store } = seedPublishedWithDue("2026-05-20", {
      planId: "plan-follow-group",
      managerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      assigneeUserId: "emp-a",
    });
    seedPublishedWithDue("2026-05-20", {
      planId: "plan-follow-personal",
      managerUserId: "mgr-b",
      assigneeUserId: "emp-b",
    });
    seedPublishedWithDue("2026-05-20", {
      planId: "plan-follow-other-personal",
      managerUserId: "mgr-c",
      assigneeUserId: "emp-c",
    });

    const rows = listFollowUpCandidatesForActor(store, "mgr-b", {
      bucket: "overdue",
      managerGroupId: "mgrgrp:mingsi",
      now: new Date("2026-05-21T12:00:00.000Z"),
    });

    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.assigneeUserId === "emp-a")).toBe(true);
    expect(rows.some((row) => row.assigneeUserId === "emp-b")).toBe(true);
    expect(rows.some((row) => row.assigneeUserId === "emp-c")).toBe(false);
  });
});
