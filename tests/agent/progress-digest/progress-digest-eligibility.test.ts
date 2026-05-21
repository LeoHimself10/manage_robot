import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import {
  isProgressDigestScanDue,
  listDigestRecipients,
  listEligibleDigestRecipients,
} from "../../../src/agent/progress-digest/progress-digest-eligibility";
import { loadProgressDigestPolicy } from "../../../src/agent/progress-digest/progress-digest-policy";

describe("progress-digest-eligibility", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "progress-digest-elig-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.PROGRESS_DIGEST_ENABLED = "1";
    process.env.PROGRESS_DIGEST_TIMEZONE = "Asia/Shanghai";
    process.env.PROGRESS_DIGEST_HOUR = "9";
    process.env.PROGRESS_DIGEST_MINUTE = "0";
    process.env.PROGRESS_DIGEST_SCAN_INTERVAL_MS = "300000";
    process.env.PROGRESS_DIGEST_WEEKDAYS_ONLY = "1";
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.PROGRESS_DIGEST_ENABLED;
    delete process.env.PROGRESS_DIGEST_TIMEZONE;
    delete process.env.PROGRESS_DIGEST_HOUR;
    delete process.env.PROGRESS_DIGEST_MINUTE;
    delete process.env.PROGRESS_DIGEST_SCAN_INTERVAL_MS;
    delete process.env.PROGRESS_DIGEST_WEEKDAYS_ONLY;
  });

  function seedTask() {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "elig-seed";
    const now = new Date().toISOString();
    const planId = "plan-elig-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: "mgr-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "Elig task",
        tasks: [
          {
            id: "task-1",
            title: "T1",
            objective: "o",
            deliverables: "d",
            completionCriteria: "c",
            timeNode: { dueAt: "2026-12-31", checkpoints: [] },
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
    return store;
  }

  it("lists digest recipients with combined audience when dual role", () => {
    const store = seedTask();
    const recipients = listDigestRecipients(store);
    expect(recipients).toHaveLength(2);
    const mgr = recipients.find((r) => r.userId === "mgr-1");
    const emp = recipients.find((r) => r.userId === "emp-1");
    expect(mgr?.audience).toBe("manager");
    expect(emp?.audience).toBe("employee");
  });

  it("fires on weekday 9:00 window only", () => {
    const policy = loadProgressDigestPolicy();
    const monday9 = new Date("2026-05-18T01:02:00.000Z");
    expect(isProgressDigestScanDue(monday9, policy)).toBe(true);
    const monday8 = new Date("2026-05-18T00:30:00.000Z");
    expect(isProgressDigestScanDue(monday8, policy)).toBe(false);
    const saturday9 = new Date("2026-05-16T01:02:00.000Z");
    expect(isProgressDigestScanDue(saturday9, policy)).toBe(false);
  });

  it("returns eligible recipients only in send window", () => {
    const store = seedTask();
    const monday9 = new Date("2026-05-18T01:02:00.000Z");
    expect(listEligibleDigestRecipients(store, monday9).length).toBe(2);
    expect(listEligibleDigestRecipients(store, new Date("2026-05-18T00:30:00.000Z")).length).toBe(0);
  });
});
