import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
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
});
