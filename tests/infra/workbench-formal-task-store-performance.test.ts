import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createWorkbenchFormalTaskStore } from "../../src/infra/workbench-formal-task-store";
import type { PlanSession } from "../../src/infra/plan-session-store";

let sqlitePath = "";

function publishOne(assignee: string, dueAt: string, planId = "plan-perf-1") {
  const store = createWorkbenchFormalTaskStore();
  const session: PlanSession = {
    chatKeyHash: "h",
    planId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    senderStaffId: "mgr-1",
    knownFacts: [],
    conversationHistory: [],
    latestDraft: {
      title: "绩效测试",
      tasks: [{ id: "t1", title: "子任务1", timeNode: { dueAt } }],
    },
    latestAssignment: {
      assignments: [{ taskId: "t1", primary: { userId: assignee, displayName: "员工" } }],
    },
  };
  const published = store.publishFromSession({
    planId,
    session,
    managerUserId: "mgr-1",
    initiatorDepartment: "质量部",
    actorUserId: "mgr-1",
  });
  return { store, subtaskId: published.subtasks[0].subtaskId };
}

describe("workbench-formal-task-store performance fields", () => {
  beforeEach(() => {
    const temp = mkdtempSync(join(tmpdir(), "perf-store-test-"));
    sqlitePath = join(temp, "workbench.sqlite");
    vi.stubEnv("WORKBENCH_SQLITE_PATH", sqlitePath);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes completed_at when subtask transitions to DONE", () => {
    const { store, subtaskId } = publishOne("emp-1", "2026-06-01");
    const before = store.getTaskDetail("plan-perf-1")?.subtasks[0];
    expect(before?.completedAt).toBeFalsy();

    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "DONE" });
    const after = store.getTaskDetail("plan-perf-1")?.subtasks[0];
    expect(after?.status).toBe("DONE");
    expect(after?.completedAt).toBeTruthy();
  });

  it("clears completed_at when subtask leaves DONE", () => {
    const { store, subtaskId } = publishOne("emp-1", "2026-06-01");
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "DONE" });
    expect(store.getTaskDetail("plan-perf-1")?.subtasks[0]?.completedAt).toBeTruthy();
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "IN_PROGRESS" });
    const reopened = store.getTaskDetail("plan-perf-1")?.subtasks[0];
    expect(reopened?.status).toBe("IN_PROGRESS");
    expect(reopened?.completedAt).toBeFalsy();
  });

  it("loadPerformanceDataset returns assignee/status/due/completed and scopes by manager", () => {
    const { store, subtaskId } = publishOne("emp-1", "2026-06-01");
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "DONE" });

    const all = store.loadPerformanceDataset();
    expect(all.subtasks).toHaveLength(1);
    expect(all.subtasks[0].assigneeUserId).toBe("emp-1");
    expect(all.subtasks[0].status).toBe("DONE");
    expect(all.subtasks[0].completedAt).toBeTruthy();

    const mineEmpty = store.loadPerformanceDataset({ managerUserId: "other-mgr" });
    expect(mineEmpty.subtasks).toHaveLength(0);
    const mine = store.loadPerformanceDataset({ managerUserId: "mgr-1" });
    expect(mine.subtasks).toHaveLength(1);
  });

  it("setSubtaskDueAt updates due and records SUBTASK_DUE_CHANGED audit event", () => {
    const { store, subtaskId } = publishOne("emp-1", "2026-06-01");
    const updated = store.setSubtaskDueAt({ subtaskId, actorUserId: "mgr-1", dueAt: "2026-06-10" });
    expect(updated.dueAt).toBe("2026-06-10T10:00:00.000Z");
    const detail = store.getTaskDetail("plan-perf-1");
    const changeEvent = detail?.events?.find((e) => e.event_type === "SUBTASK_DUE_CHANGED");
    expect(changeEvent).toBeTruthy();
    const payload = JSON.parse(String(changeEvent?.payload_json ?? "{}")) as Record<string, unknown>;
    expect(payload.to).toBe("2026-06-10T10:00:00.000Z");
  });

  it("backfills completed_at for legacy DONE rows from progress events", () => {
    const { store, subtaskId } = publishOne("emp-1", "2026-06-01");
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "progress", progressStatus: "DONE" });
    // Simulate legacy row: completed_at missing but DONE + progress event exists.
    const db = new DatabaseSync(sqlitePath);
    db.prepare("UPDATE subtasks SET completed_at = NULL WHERE subtask_id = ?").run(subtaskId);
    db.close();
    // New store instance runs backfill on init.
    const store2 = createWorkbenchFormalTaskStore();
    const after = store2.getTaskDetail("plan-perf-1")?.subtasks[0];
    expect(after?.completedAt).toBeTruthy();
  });
});
