import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWorkbenchFormalTaskStore } from "../../../src/infra/workbench-formal-task-store";
import { createPlanSessionStore } from "../../../src/infra/plan-session-store";
import { buildProgressDigestMarkdown } from "../../../src/agent/progress-digest/progress-digest-build";
import { loadProgressDigestPolicy } from "../../../src/agent/progress-digest/progress-digest-policy";

describe("progress-digest-build", () => {
  let sqlitePath = "";
  let sessionDir = "";

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "progress-digest-build-"));
    sqlitePath = join(tmp, "wb.sqlite");
    sessionDir = join(tmp, "sessions");
    process.env.WORKBENCH_SQLITE_PATH = sqlitePath;
    process.env.PLAN_SESSION_DIR = sessionDir;
    process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL = "https://example.com";
    process.env.PROGRESS_DIGEST_LLM_ENABLED = "0";
    process.env.PROGRESS_DIGEST_MODE = "full";
  });

  afterEach(() => {
    delete process.env.WORKBENCH_SQLITE_PATH;
    delete process.env.PLAN_SESSION_DIR;
    delete process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL;
    delete process.env.PROGRESS_DIGEST_LLM_ENABLED;
    delete process.env.PROGRESS_DIGEST_MODE;
  });

  function seedInProgressTask() {
    const planSessionStore = createPlanSessionStore();
    const chatKeyHash = "build-seed";
    const now = new Date().toISOString();
    const planId = "plan-build-1";
    planSessionStore.save({
      chatKeyHash,
      planId,
      createdAt: now,
      updatedAt: now,
      senderStaffId: "mgr-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "Build digest",
        tasks: [
          {
            id: "task-1",
            title: "执行子任务",
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
    const detail = store.getTaskDetail(planId)!;
    const subtaskId = detail.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId, actorUserId: "emp-1", action: "accept" });
    store.appendTaskEvent({
      taskId: detail.task.taskId,
      subtaskId,
      eventType: "SUBTASK_PROGRESS",
      actorUserId: "emp-1",
      note: "已完成采样",
      occurredAt: new Date().toISOString(),
    });
    return { store, detail };
  }

  it("builds full manager digest via template when LLM disabled", async () => {
    const { store } = seedInProgressTask();
    const policy = loadProgressDigestPolicy();
    const built = await buildProgressDigestMarkdown({
      taskStore: store,
      userId: "mgr-1",
      audience: "manager",
      policy,
      now: new Date("2026-05-18T01:00:00.000Z"),
    });
    expect(built.mode).toBe("full");
    expect(built.renderSource).toBe("template");
    expect(built.markdown).toContain("今日任务一览");
    expect(built.markdown).toContain("需您处理");
    expect(built.markdown).toContain("昨日动态");
    expect(built.markdown).not.toContain("状态汇总");
  });

  it("builds brief digest when no active tasks", async () => {
    const { store, detail } = seedInProgressTask();
    const subtaskId = detail.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({
      subtaskId,
      actorUserId: "emp-1",
      action: "progress",
      progressStatus: "DONE",
    });
    const built = await buildProgressDigestMarkdown({
      taskStore: store,
      userId: "mgr-1",
      audience: "manager",
      policy: loadProgressDigestPolicy(),
      now: new Date("2026-05-18T01:00:00.000Z"),
    });
    expect(built.mode).toBe("brief");
    expect(built.markdown).toContain("没有需要跟进的活跃任务");
  });

  it("builds combined digest for dual-role user", async () => {
    const { store } = seedInProgressTask();
    const built = await buildProgressDigestMarkdown({
      taskStore: store,
      userId: "mgr-1",
      audience: "combined",
      policy: loadProgressDigestPolicy(),
      now: new Date("2026-05-18T01:00:00.000Z"),
    });
    expect(built.mode).toBe("full");
    expect(built.markdown).toContain("我主管的任务");
    expect(built.markdown).toContain("我负责的任务");
  });

  it("builds delivery reminder digest with due-soon table only", async () => {
    process.env.PROGRESS_DIGEST_MODE = "delivery_reminder";
    const { store } = seedInProgressTask();
    const built = await buildProgressDigestMarkdown({
      taskStore: store,
      userId: "mgr-1",
      audience: "manager",
      policy: loadProgressDigestPolicy(),
      now: new Date("2026-12-25T01:00:00.000Z"),
    });
    expect(built.mode).toBe("delivery");
    expect(built.renderSource).toBe("template");
    expect(built.markdown).toContain("近一周交付提醒");
    expect(built.markdown).toContain("#### 1. Build digest · 执行子任务");
    expect(built.markdown).toContain("- **负责人**：emp-1");
    expect(built.markdown).not.toMatch(/\| --- \|/);
    expect(built.markdown).not.toContain("昨日动态");
    expect(built.markdown).not.toContain("后续建议");
  });

  it("builds delivery brief when no due-soon items in horizon", async () => {
    process.env.PROGRESS_DIGEST_MODE = "delivery_reminder";
    const { store } = seedInProgressTask();
    const built = await buildProgressDigestMarkdown({
      taskStore: store,
      userId: "mgr-1",
      audience: "manager",
      policy: loadProgressDigestPolicy(),
      now: new Date("2026-01-01T01:00:00.000Z"),
    });
    expect(built.mode).toBe("brief");
    expect(built.markdown).toContain("近一周暂无到期子任务");
  });
});
