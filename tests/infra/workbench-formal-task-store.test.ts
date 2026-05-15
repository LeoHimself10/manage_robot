import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  createWorkbenchFormalTaskStore,
  TASK_DESCRIPTION_MAX_DB,
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
    expect(published.subtasks[0].sourceTaskKey).toBe("draft-task-a");
  });

  it("persists extra_json from draft and maps back to extra", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-extra",
      planId: "plan-extra-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "带依赖",
        tasks: [
          {
            id: "task_1",
            title: "前置",
            dependencyTaskIds: [],
            timeNode: { dueAt: "2026-06-01", checkpoints: [] },
            risksAndOpenQuestions: [],
          },
          {
            id: "task_2",
            title: "后续",
            dependencyTaskIds: ["task_1"],
            timeNode: { dueAt: "2026-06-02", checkpoints: ["M1 评审"] },
            risksAndOpenQuestions: ["样品可能延迟"],
          },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "task_1", primary: { userId: "emp-a" } },
          { taskId: "task_2", primary: { userId: "emp-b" } },
        ],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-extra-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const t2 = published.subtasks.find((s) => s.sourceTaskKey === "task_2");
    expect(t2?.extra).toMatchObject({
      v: 1,
      dependsOn: ["task_1"],
      checkpoints: ["M1 评审"],
      risks: ["样品可能延迟"],
    });
    const t1 = published.subtasks.find((s) => s.sourceTaskKey === "task_1");
    expect(t1?.extra).toBeUndefined();
    const detail = store.getTaskDetail("plan-extra-1");
    expect(detail?.subtasks.find((s) => s.sourceTaskKey === "task_2")?.extra).toEqual(t2?.extra);
  });

  it("tolerates invalid extra_json when loading subtasks", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-badjson",
      planId: "plan-badjson",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: { title: "X", tasks: [{ id: "t1", title: "子1" }] },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "emp-bj" } }] },
    };
    const published = store.publishFromSession({
      planId: "plan-badjson",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const subId = published.subtasks[0]?.subtaskId;
    if (!subId) throw new Error("expected subtask");
    const sqlitePath = process.env.WORKBENCH_SQLITE_PATH;
    if (!sqlitePath) throw new Error("WORKBENCH_SQLITE_PATH missing");
    const raw = new DatabaseSync(sqlitePath);
    raw.prepare("UPDATE subtasks SET extra_json = ? WHERE subtask_id = ?").run("{not-json", subId);
    raw.close();
    const reopened = createWorkbenchFormalTaskStore();
    const detail = reopened.getTaskDetail("plan-badjson");
    expect(detail?.subtasks[0]?.extra).toBeUndefined();
  });

  it("adds extra_json via ALTER on legacy db missing column", () => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-legacy-"));
    const legacyPath = join(temp, "legacy.sqlite");
    const raw = new DatabaseSync(legacyPath);
    raw.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        task_no TEXT UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        initiator_user_id TEXT NOT NULL,
        initiator_department TEXT NOT NULL,
        manager_user_id TEXT NOT NULL,
        source_trace_id TEXT,
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE subtasks (
        subtask_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        source_task_key TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT,
        deliverables TEXT,
        completion_criteria TEXT,
        due_at TEXT,
        feedback_frequency TEXT,
        assignee_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_note TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, source_task_key)
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        subtask_id TEXT,
        event_type TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        note TEXT,
        payload_json TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        before_value INTEGER NOT NULL,
        after_value INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS dingtalk_contacts (
        user_id TEXT PRIMARY KEY,
        union_id TEXT,
        name TEXT NOT NULL,
        department_ids_json TEXT NOT NULL DEFAULT '[]',
        department_names_json TEXT NOT NULL DEFAULT '[]',
        position TEXT,
        job_number TEXT,
        mobile_masked TEXT,
        email_masked TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_boss INTEGER NOT NULL DEFAULT 0,
        is_senior INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        last_synced_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);
    raw.close();
    vi.stubEnv("WORKBENCH_SQLITE_PATH", legacyPath);
    const store = createWorkbenchFormalTaskStore();
    const cols = new DatabaseSync(legacyPath)
      .prepare("PRAGMA table_info(subtasks)")
      .all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "extra_json")).toBe(true);
    const session: PlanSession = {
      chatKeyHash: "h-leg",
      planId: "plan-leg-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "L",
        tasks: [
          {
            id: "t1",
            title: "子",
            dependencyTaskIds: ["task_x"],
            timeNode: { checkpoints: ["c1"] },
            risksAndOpenQuestions: ["r1"],
          },
        ],
      },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "emp-leg" } }] },
    };
    const pub = store.publishFromSession({
      planId: "plan-leg-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    expect(pub.subtasks[0]?.extra?.dependsOn).toEqual(["task_x"]);
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

  it("persists task description from latestDraft and maps in getTaskDetail", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-desc",
      planId: "plan-desc-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "带背景",
        description: "产线异常排查整体背景",
        tasks: [{ id: "t1", title: "子1" }],
      },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "emp-d1" } }] },
    };
    store.publishFromSession({
      planId: "plan-desc-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const detail = store.getTaskDetail("plan-desc-1");
    expect(detail?.task.description).toBe("产线异常排查整体背景");
  });

  it("maps task description from draft.summary when description absent", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-sum",
      planId: "plan-sum-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "仅摘要",
        summary: "旧版 summary 作背景",
        tasks: [{ id: "t1", title: "子1" }],
      },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "emp-s1" } }] },
    };
    store.publishFromSession({
      planId: "plan-sum-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    expect(store.getTaskDetail("plan-sum-1")?.task.description).toBe("旧版 summary 作背景");
  });

  it("truncates task description over TASK_DESCRIPTION_MAX_DB", () => {
    const store = createWorkbenchFormalTaskStore();
    const longDesc = "D".repeat(TASK_DESCRIPTION_MAX_DB + 80);
    const session: PlanSession = {
      chatKeyHash: "hash-long",
      planId: "plan-long-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "长背景",
        description: longDesc,
        tasks: [{ id: "t1", title: "子1" }],
      },
      latestAssignment: { assignments: [{ taskId: "t1", primary: { userId: "emp-l1" } }] },
    };
    store.publishFromSession({
      planId: "plan-long-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const d = store.getTaskDetail("plan-long-1")?.task.description ?? "";
    expect(d.length).toBe(TASK_DESCRIPTION_MAX_DB);
  });

  it("adds tasks.description via ALTER on legacy db missing column", () => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-legacy-desc-"));
    const legacyPath = join(temp, "legacy-no-desc.sqlite");
    const raw = new DatabaseSync(legacyPath);
    raw.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        task_no TEXT UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        initiator_user_id TEXT NOT NULL,
        initiator_department TEXT NOT NULL,
        manager_user_id TEXT NOT NULL,
        source_trace_id TEXT,
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE subtasks (
        subtask_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        source_task_key TEXT NOT NULL,
        title TEXT NOT NULL,
        objective TEXT,
        deliverables TEXT,
        completion_criteria TEXT,
        due_at TEXT,
        feedback_frequency TEXT,
        assignee_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress_note TEXT,
        extra_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, source_task_key)
      );
      CREATE TABLE IF NOT EXISTS task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        subtask_id TEXT,
        event_type TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        note TEXT,
        payload_json TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS permission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        before_value INTEGER NOT NULL,
        after_value INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS dingtalk_contacts (
        user_id TEXT PRIMARY KEY,
        union_id TEXT,
        name TEXT NOT NULL,
        department_ids_json TEXT NOT NULL DEFAULT '[]',
        department_names_json TEXT NOT NULL DEFAULT '[]',
        position TEXT,
        job_number TEXT,
        mobile_masked TEXT,
        email_masked TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_boss INTEGER NOT NULL DEFAULT 0,
        is_senior INTEGER NOT NULL DEFAULT 0,
        raw_json TEXT,
        last_synced_at TEXT NOT NULL,
        deleted_at TEXT
      );
    `);
    raw.close();
    vi.stubEnv("WORKBENCH_SQLITE_PATH", legacyPath);
    createWorkbenchFormalTaskStore();
    const cols = new DatabaseSync(legacyPath)
      .prepare("PRAGMA table_info(tasks)")
      .all() as Array<{ name: string }>;
    expect(cols.some((c) => c.name === "description")).toBe(true);
  });
});
