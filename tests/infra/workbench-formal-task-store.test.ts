import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  createWorkbenchFormalTaskStore,
} from "../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../src/infra/plan-session-store";

describe("workbench-formal-task-store mapping", () => {
  beforeEach(() => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-test-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(temp, "workbench.sqlite"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("maps draft task id to subtask source key and keeps dueAt from timeNode", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-1",
      planId: "plan-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [{ role: "user", content: "发布任务" }],
      latestDraft: {
        title: "测试发布",
        tasks: [
          {
            id: "draft-task-a",
            title: "任务A",
            objective: "目标A",
            timeNode: { dueAt: "2026-06-01" },
            feedbackFrequency: "每日",
          },
        ],
      },
      latestAssignment: {
        assignments: [
          {
            taskId: "draft-task-a",
            primary: { userId: "emp-1", displayName: "员工A" },
          },
        ],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    expect(published.subtasks).toHaveLength(1);
    expect(published.subtasks[0].subtaskId).toContain("draft-task-a");
    expect(published.subtasks[0].dueAt).toBe("2026-06-01");
  });

  it("accept action sets subtask to IN_PROGRESS and keeps SUBTASK_ACCEPTED event", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-accept",
      planId: "plan-accept-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "T",
        tasks: [{ id: "t1", title: "子1" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-accept-1" } }],
      },
    };
    store.publishFromSession({
      planId: "plan-accept-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const subId = `task:plan-accept-1:t1`;
    const out = store.updateSubtaskStatus({
      subtaskId: subId,
      actorUserId: "emp-accept-1",
      action: "accept",
    });
    expect(out.subtask.status).toBe("IN_PROGRESS");
    const detail = store.getTaskDetail("plan-accept-1");
    const types = (detail?.events ?? []).map((e) => String((e as { event_type?: string }).event_type ?? ""));
    expect(types).toContain("SUBTASK_ACCEPTED");
  });

  it("migrates legacy ACCEPTED subtasks to IN_PROGRESS when opening the store", () => {
    const sqlitePath = process.env.WORKBENCH_SQLITE_PATH;
    if (!sqlitePath) throw new Error("WORKBENCH_SQLITE_PATH missing");
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-mig",
      planId: "plan-mig-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "T",
        tasks: [{ id: "t1", title: "子1" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-mig-1" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-mig-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const subId = published.subtasks[0]?.subtaskId;
    if (!subId) throw new Error("expected subtask");
    const raw = new DatabaseSync(sqlitePath);
    raw.prepare("UPDATE subtasks SET status = 'ACCEPTED' WHERE subtask_id = ?").run(subId);
    raw.close();
    const reopened = createWorkbenchFormalTaskStore();
    const detail = reopened.getTaskDetail("plan-mig-1");
    expect(detail?.subtasks[0]?.status).toBe("IN_PROGRESS");
    const verify = new DatabaseSync(sqlitePath);
    const row = verify.prepare("SELECT COUNT(*) AS c FROM subtasks WHERE status = 'ACCEPTED'").get() as {
      c: number;
    };
    expect(row.c).toBe(0);
    verify.close();
  });
});
