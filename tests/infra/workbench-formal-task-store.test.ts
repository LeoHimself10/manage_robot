import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  aggregateTaskStatus,
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
    expect(published.subtasks[0].dueAt).toBe("2026-06-01T10:00:00.000Z");
    expect(published.subtasks[0].sourceTaskKey).toBe("draft-task-a");
  });

  it("persists rich fields from draft into flat columns", () => {
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
    expect(t2?.dependsOn).toEqual(["task_1"]);
    expect(t2?.checkpoints).toBeUndefined();
    expect(t2?.risks).toBeUndefined();
    const t1 = published.subtasks.find((s) => s.sourceTaskKey === "task_1");
    expect(t1?.dependsOn).toBeUndefined();
    const detail = store.getTaskDetail("plan-extra-1");
    const detailT2 = detail?.subtasks.find((s) => s.sourceTaskKey === "task_2");
    expect(detailT2?.dependsOn).toEqual(["task_1"]);
    expect(detailT2?.checkpoints).toBeUndefined();
    expect(detailT2?.risks).toBeUndefined();
  });

  it("persists v2 rich fields (inputMaterials/actions/collaborators/scope) as flat columns", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-v2",
      planId: "plan-v2-1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "研发验证",
        tasks: [
          {
            id: "task_1",
            title: "子任务",
            dependencyTaskIds: [],
            timeNode: { dueAt: "2026-06-01", checkpoints: [] },
            risksAndOpenQuestions: [],
            inputMaterials: ["需求文档"],
            actions: ["跑用例"],
            collaborators: ["测试"],
            scope: { inScope: ["功能 A"], outOfScope: ["不做性能"] },
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "task_1", primary: { userId: "emp-v2" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-v2-1",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "研发部",
      actorUserId: "manager-1",
    });
    const s1 = published.subtasks.find((x) => x.sourceTaskKey === "task_1");
    expect(s1?.inputMaterials).toBeUndefined();
    expect(s1?.actions).toEqual(["跑用例"]);
    expect(s1?.collaborators).toBeUndefined();
    expect(s1?.inScope).toBeUndefined();
    expect(s1?.outOfScope).toBeUndefined();
  });

  it("tolerates invalid JSON in flat rich columns when loading subtasks", () => {
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
    raw.prepare("UPDATE subtasks SET depends_on = ? WHERE subtask_id = ?").run("{not-json", subId);
    raw.close();
    const reopened = createWorkbenchFormalTaskStore();
    const detail = reopened.getTaskDetail("plan-badjson");
    expect(detail?.subtasks[0]?.dependsOn).toBeUndefined();
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
    expect(cols.some((c) => c.name === "depends_on")).toBe(true);
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
    expect(pub.subtasks[0]?.dependsOn).toEqual(["task_x"]);
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

describe("employee / manager subtask flows", () => {
  beforeEach(() => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-flow-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(temp, "workbench.sqlite"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("listEmployeeSubtasks sorts REJECTED to the bottom", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-rej-sort",
      planId: "plan-rej-sort",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "双子任务",
        tasks: [
          {
            id: "t_a",
            title: "A",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
          {
            id: "t_b",
            title: "B",
            timeNode: { dueAt: "2026-06-02" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "t_a", primary: { userId: "emp-sort", displayName: "E" } },
          { taskId: "t_b", primary: { userId: "emp-sort", displayName: "E" } },
        ],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-rej-sort",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const subA = published.subtasks.find((s) => s.sourceTaskKey === "t_a");
    const subB = published.subtasks.find((s) => s.sourceTaskKey === "t_b");
    expect(subA && subB).toBeTruthy();
    store.updateSubtaskStatus({
      subtaskId: subA!.subtaskId,
      actorUserId: "emp-sort",
      action: "reject",
      note: "无法承接",
    });
    const list = store.listEmployeeSubtasks("emp-sort");
    expect(list).toHaveLength(2);
    expect(list[list.length - 1].subtaskId).toBe(subA!.subtaskId);
    expect(list[list.length - 1].status).toBe("REJECTED");
  });

  it("updateSubtaskStatus customize keeps IN_PROGRESS and emits SUBTASK_CUSTOMIZE_NOTE", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-cust",
      planId: "plan-cust",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "单任务",
        tasks: [
          {
            id: "t_only",
            title: "Only",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t_only", primary: { userId: "emp-cust", displayName: "C" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-cust",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-cust", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-cust",
      action: "customize",
      note: "补充说明一条",
    });
    const detail = store.getTaskDetail("plan-cust");
    expect(detail?.subtasks[0]?.status).toBe("IN_PROGRESS");
    const types = (detail?.events ?? []).map((e) => String(e.event_type ?? ""));
    expect(types).toContain("SUBTASK_CUSTOMIZE_NOTE");
    expect(types.filter((t) => t === "SUBTASK_CHANGES_REQUESTED").length).toBe(0);
  });

  it("managerDeclineSubtaskChanges returns subtask to IN_PROGRESS", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-dec",
      planId: "plan-dec",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "单任务",
        tasks: [
          {
            id: "t_x",
            title: "X",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t_x", primary: { userId: "emp-dec", displayName: "D" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-dec",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-dec", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-dec",
      action: "request_changes",
      note: "要改截止",
    });
    const out = store.managerDeclineSubtaskChanges({
      subtaskId: sid,
      managerUserId: "manager-1",
      note: "维持原计划",
    });
    expect(out.subtask.status).toBe("IN_PROGRESS");
    const ev = store.getTaskDetail("plan-dec")?.events ?? [];
    expect(ev.some((e) => String(e.event_type) === "MANAGER_DECLINE_CHANGES")).toBe(true);
  });

  it("getSubtaskOpenDeclineKind reflects open change request after request_changes", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-odk",
      planId: "plan-odk",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "单任务",
        tasks: [
          {
            id: "t_o",
            title: "O",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t_o", primary: { userId: "emp-odk", displayName: "O" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-odk",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-odk", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-odk",
      action: "request_changes",
      note: "要调整",
    });
    expect(store.getSubtaskOpenDeclineKind(sid)).toBe("changes");
    store.managerDeclineSubtaskChanges({ subtaskId: sid, managerUserId: "manager-1", note: "不行" });
    expect(store.getSubtaskOpenDeclineKind(sid)).toBeNull();
  });

  it("managerDeclineSubtaskChanges still works when employee posted progress after change request", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-dec2",
      planId: "plan-dec2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "单任务",
        tasks: [
          {
            id: "t_x2",
            title: "X2",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t_x2", primary: { userId: "emp-dec2", displayName: "D2" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-dec2",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-dec2", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-dec2",
      action: "request_changes",
      note: "要改截止",
    });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-dec2",
      action: "progress",
      note: "同步下进度",
      progressStatus: "IN_PROGRESS",
    });
    const out = store.managerDeclineSubtaskChanges({
      subtaskId: sid,
      managerUserId: "manager-1",
      note: "维持原计划",
    });
    expect(out.subtask.status).toBe("IN_PROGRESS");
  });

  it("reassignTask removes subtask from prior assignee listEmployeeSubtasks", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "h-reas",
      planId: "plan-reas",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "单任务",
        tasks: [
          {
            id: "t_r",
            title: "R",
            timeNode: { dueAt: "2026-06-01" },
            dependencyTaskIds: [],
            risksAndOpenQuestions: [],
          },
        ],
      },
      latestAssignment: {
        assignments: [{ taskId: "t_r", primary: { userId: "emp-old", displayName: "O" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-reas",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    expect(store.listEmployeeSubtasks("emp-old")).toHaveLength(1);
    store.reassignTask({
      planId: "plan-reas",
      managerUserId: "manager-1",
      assigneeUserId: "emp-new",
      subtaskId: sid,
    });
    expect(store.listEmployeeSubtasks("emp-old")).toHaveLength(0);
    expect(store.listEmployeeSubtasks("emp-new")).toHaveLength(1);
    expect(store.listEmployeeSubtasks("emp-new")[0]!.subtaskId).toBe(sid);
  });

  it("stopTask stops non-DONE subtasks and preserves DONE", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-stop",
      planId: "plan-stop",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "停止测试",
        tasks: [
          { id: "t_done", title: "已完成" },
          { id: "t_run", title: "进行中" },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "t_done", primary: { userId: "emp-a" } },
          { taskId: "t_run", primary: { userId: "emp-b" } },
        ],
      },
    };
    store.publishFromSession({
      planId: "plan-stop",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const detailBefore = store.getTaskDetail("plan-stop")!;
    const doneSub = detailBefore.subtasks.find((s) => s.sourceTaskKey === "t_done")!;
    const runSub = detailBefore.subtasks.find((s) => s.sourceTaskKey === "t_run")!;
    store.updateSubtaskStatus({
      subtaskId: doneSub.subtaskId,
      actorUserId: "emp-a",
      action: "accept",
    });
    store.updateSubtaskStatus({
      subtaskId: doneSub.subtaskId,
      actorUserId: "emp-a",
      action: "progress",
      progressStatus: "DONE",
      note: "完成",
    });
    store.updateSubtaskStatus({
      subtaskId: runSub.subtaskId,
      actorUserId: "emp-b",
      action: "accept",
    });
    const stopped = store.stopTask({
      planId: "plan-stop",
      managerUserId: "manager-1",
      note: "项目取消",
    });
    expect(stopped.alreadyStopped).toBe(false);
    expect(stopped.stoppedSubtaskIds).toContain(runSub.subtaskId);
    const doneAfter = stopped.subtasks.find((s) => s.subtaskId === doneSub.subtaskId)!;
    const runAfter = stopped.subtasks.find((s) => s.subtaskId === runSub.subtaskId)!;
    expect(doneAfter.status).toBe("DONE");
    expect(runAfter.status).toBe("STOPPED");
    expect(stopped.task.status).toBe("STOPPED");
  });

  it("stopTask is idempotent when nothing left to stop", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-stop2",
      planId: "plan-stop2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "全完成",
        tasks: [{ id: "t1", title: "唯一" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-stop2",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.updateSubtaskStatus({ subtaskId: sid, actorUserId: "emp-a", action: "accept" });
    store.updateSubtaskStatus({
      subtaskId: sid,
      actorUserId: "emp-a",
      action: "progress",
      progressStatus: "DONE",
      note: "ok",
    });
    const again = store.stopTask({
      planId: "plan-stop2",
      managerUserId: "manager-1",
      note: "noop",
    });
    expect(again.alreadyStopped).toBe(true);
    expect(again.stoppedSubtaskIds).toEqual([]);
    expect(again.task.status).toBe("DONE");
  });

  it("appendSubtask adds row and rejects on stopped task", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-add",
      planId: "plan-add",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "追加测试",
        tasks: [{ id: "t1", title: "原任务" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    store.publishFromSession({
      planId: "plan-add",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const added = store.appendSubtask({
      planId: "plan-add",
      managerUserId: "manager-1",
      title: "手动新增",
      assigneeUserId: "emp-b",
      objective: "完成补增工作",
      deliverables: "补增交付物",
      completionCriteria: "验收通过",
      dueAt: "2026-06-01",
    });
    expect(added.subtask.title).toBe("手动新增");
    expect(added.subtask.status).toBe("ASSIGNED");
    expect(added.subtask.sourceTaskKey).toMatch(/^manual-/);
    expect(store.getTaskDetail("plan-add")?.subtasks).toHaveLength(2);

    store.stopTask({ planId: "plan-add", managerUserId: "manager-1", note: "停" });
    expect(() =>
      store.appendSubtask({
        planId: "plan-add",
        managerUserId: "manager-1",
        title: "不应成功",
        assigneeUserId: "emp-c",
        objective: "x",
        deliverables: "y",
        completionCriteria: "z",
        dueAt: "2026-06-02",
      }),
    ).toThrow(/stopped/i);
  });

  it("appendSubtask deduplicates identical manual add within window", () => {
    vi.stubEnv("WORKBENCH_APPEND_SUBTASK_DEDUP_SECONDS", "60");
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-dedup",
      planId: "plan-dedup",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "去重测试",
        tasks: [{ id: "t1", title: "原任务" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    store.publishFromSession({
      planId: "plan-dedup",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const payload = {
      planId: "plan-dedup",
      managerUserId: "manager-1",
      title: "样品截留",
      assigneeUserId: "emp-b",
      objective: "复现",
      deliverables: "报告",
      completionCriteria: "可验收",
      dueAt: "2026-06-15",
    };
    const first = store.appendSubtask(payload);
    const second = store.appendSubtask(payload);
    expect(first.duplicated).not.toBe(true);
    expect(second.duplicated).toBe(true);
    expect(second.subtask.subtaskId).toBe(first.subtask.subtaskId);
    expect(store.getTaskDetail("plan-dedup")?.subtasks).toHaveLength(2);
  });

  it("appendSubtask deduplicates by clientRequestId", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-crid",
      planId: "plan-crid",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "clientRequestId",
        tasks: [{ id: "t1", title: "原任务" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    store.publishFromSession({
      planId: "plan-crid",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const payload = {
      planId: "plan-crid",
      managerUserId: "manager-1",
      title: "唯一子任务",
      assigneeUserId: "emp-b",
      objective: "目标",
      deliverables: "交付",
      completionCriteria: "标准",
      dueAt: "2026-06-20",
      clientRequestId: "req-abc-123",
    };
    const first = store.appendSubtask(payload);
    const second = store.appendSubtask({
      ...payload,
      title: "不同标题也应去重",
      objective: "不同目标",
    });
    expect(first.duplicated).not.toBe(true);
    expect(second.duplicated).toBe(true);
    expect(second.subtask.subtaskId).toBe(first.subtask.subtaskId);
    expect(store.getTaskDetail("plan-crid")?.subtasks).toHaveLength(2);
  });

  it("appendSubtask allows same title with different objective within window", () => {
    vi.stubEnv("WORKBENCH_APPEND_SUBTASK_DEDUP_SECONDS", "60");
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-dedup2",
      planId: "plan-dedup2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "去重测试2",
        tasks: [{ id: "t1", title: "原任务" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    store.publishFromSession({
      planId: "plan-dedup2",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    store.appendSubtask({
      planId: "plan-dedup2",
      managerUserId: "manager-1",
      title: "同名",
      assigneeUserId: "emp-b",
      objective: "目标A",
      deliverables: "交付A",
      completionCriteria: "标准A",
      dueAt: "2026-06-15",
    });
    const second = store.appendSubtask({
      planId: "plan-dedup2",
      managerUserId: "manager-1",
      title: "同名",
      assigneeUserId: "emp-b",
      objective: "目标B",
      deliverables: "交付B",
      completionCriteria: "标准B",
      dueAt: "2026-06-15",
    });
    expect(second.duplicated).not.toBe(true);
    expect(store.getTaskDetail("plan-dedup2")?.subtasks).toHaveLength(3);
  });

  it("stopSubtask stops one row and keeps task active when others in progress", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-partial-stop",
      planId: "plan-partial-stop",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "部分停止",
        tasks: [
          { id: "t_a", title: "A" },
          { id: "t_b", title: "B" },
        ],
      },
      latestAssignment: {
        assignments: [
          { taskId: "t_a", primary: { userId: "emp-a" } },
          { taskId: "t_b", primary: { userId: "emp-b" } },
        ],
      },
    };
    store.publishFromSession({
      planId: "plan-partial-stop",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const detail = store.getTaskDetail("plan-partial-stop")!;
    const subA = detail.subtasks.find((s) => s.sourceTaskKey === "t_a")!;
    const subB = detail.subtasks.find((s) => s.sourceTaskKey === "t_b")!;
    store.updateSubtaskStatus({ subtaskId: subB.subtaskId, actorUserId: "emp-b", action: "accept" });
    const stopped = store.stopSubtask({
      planId: "plan-partial-stop",
      subtaskId: subA.subtaskId,
      managerUserId: "manager-1",
      note: "A 取消",
    });
    expect(stopped.alreadyStopped).toBe(false);
    expect(stopped.subtask.status).toBe("STOPPED");
    expect(stopped.task.status).toBe("IN_PROGRESS");
    const appended = store.appendSubtask({
      planId: "plan-partial-stop",
      managerUserId: "manager-1",
      title: "补增 C",
      assigneeUserId: "emp-c",
      objective: "继续推进",
      deliverables: "C 交付",
      completionCriteria: "完成 C",
      dueAt: "2026-07-01",
    });
    expect(appended.subtask.title).toBe("补增 C");
    expect(store.getTaskDetail("plan-partial-stop")?.subtasks).toHaveLength(3);
  });

  it("updateSubtaskStatus rejects STOPPED subtask", () => {
    const store = createWorkbenchFormalTaskStore();
    const session: PlanSession = {
      chatKeyHash: "hash-emp-stop",
      planId: "plan-emp-stop",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "员工门禁",
        tasks: [{ id: "t1", title: "子" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-a" } }],
      },
    };
    const published = store.publishFromSession({
      planId: "plan-emp-stop",
      session,
      managerUserId: "manager-1",
      initiatorDepartment: "质控",
      actorUserId: "manager-1",
    });
    const sid = published.subtasks[0]!.subtaskId;
    store.stopTask({ planId: "plan-emp-stop", managerUserId: "manager-1", note: "停" });
    expect(() =>
      store.updateSubtaskStatus({
        subtaskId: sid,
        actorUserId: "emp-a",
        action: "accept",
      }),
    ).toThrow(/stopped/i);
  });
});

describe("aggregateTaskStatus", () => {
  it("prefers REJECTED over CHANGES_REQUESTED", () => {
    expect(aggregateTaskStatus(["CHANGES_REQUESTED", "REJECTED"])).toBe("REJECTED");
  });

  it("still prioritizes IN_PROGRESS over REJECTED", () => {
    expect(aggregateTaskStatus(["IN_PROGRESS", "REJECTED"])).toBe("IN_PROGRESS");
  });

  it("returns STOPPED only when no active subtasks remain", () => {
    expect(aggregateTaskStatus(["DONE", "STOPPED"])).toBe("STOPPED");
    expect(aggregateTaskStatus(["IN_PROGRESS", "STOPPED"])).toBe("IN_PROGRESS");
    expect(aggregateTaskStatus(["STOPPED", "STOPPED"])).toBe("STOPPED");
  });

  it("returns DONE when all subtasks done", () => {
    expect(aggregateTaskStatus(["DONE", "DONE"])).toBe("DONE");
  });
});

describe("workbench-formal-task-store projects", () => {
  beforeEach(() => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-project-"));
    vi.stubEnv("WORKBENCH_SQLITE_PATH", join(temp, "workbench.sqlite"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function baseSession(planId: string): PlanSession {
    return {
      chatKeyHash: `hash-${planId}`,
      planId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      senderStaffId: "manager-1",
      knownFacts: [],
      conversationHistory: [],
      latestDraft: {
        title: "项目绑定发布",
        tasks: [{ id: "t1", title: "子任务一" }],
      },
      latestAssignment: {
        assignments: [{ taskId: "t1", primary: { userId: "emp-1" } }],
      },
    };
  }

  it("publishFromSession without projectId leaves project_id NULL", () => {
    const store = createWorkbenchFormalTaskStore();
    const published = store.publishFromSession({
      planId: "plan-no-proj",
      session: baseSession("plan-no-proj"),
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    expect(published.task.projectId).toBeUndefined();
    const db = new DatabaseSync(process.env.WORKBENCH_SQLITE_PATH!);
    const row = db.prepare("SELECT project_id FROM tasks WHERE plan_id = ?").get("plan-no-proj") as {
      project_id: string | null;
    };
    expect(row.project_id).toBeNull();
    db.close();
  });

  it("publishFromSession with valid projectId binds task", () => {
    const store = createWorkbenchFormalTaskStore();
    const project = store.createProject({
      ownerUserId: "manager-1",
      name: "OCT 专项",
      description: "客诉闭环",
    });
    const published = store.publishFromSession({
      planId: "plan-with-proj",
      session: baseSession("plan-with-proj"),
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
      projectId: project.projectId,
    });
    expect(published.task.projectId).toBe(project.projectId);
  });

  it("publishFromSession rejects invalid project_id", () => {
    const store = createWorkbenchFormalTaskStore();
    expect(() =>
      store.publishFromSession({
        planId: "plan-bad-proj",
        session: baseSession("plan-bad-proj"),
        managerUserId: "manager-1",
        initiatorDepartment: "质量部",
        actorUserId: "manager-1",
        projectId: "proj:does-not-exist",
      }),
    ).toThrow(/Invalid or inaccessible project_id/);
  });

  it("listManagerTasks filters by projectId and unassigned bucket", () => {
    const store = createWorkbenchFormalTaskStore();
    const project = store.createProject({
      ownerUserId: "manager-1",
      name: "注册申报",
    });
    store.publishFromSession({
      planId: "plan-a",
      session: baseSession("plan-a"),
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
      projectId: project.projectId,
    });
    store.publishFromSession({
      planId: "plan-b",
      session: baseSession("plan-b"),
      managerUserId: "manager-1",
      initiatorDepartment: "质量部",
      actorUserId: "manager-1",
    });
    const all = store.listManagerTasks("manager-1");
    expect(all).toHaveLength(2);
    const filtered = store.listManagerTasks("manager-1", { projectId: project.projectId });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.planId).toBe("plan-a");
    const unassigned = store.listManagerTasks("manager-1", { projectId: "__unassigned__" });
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0]?.planId).toBe("plan-b");
  });

  it("publishes projects and tasks into a manager group scope", () => {
    const store = createWorkbenchFormalTaskStore();
    const project = store.createProject({
      ownerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      name: "Mingsi launch",
    });
    const published = store.publishFromSession({
      planId: "plan-group-a",
      session: baseSession("plan-group-a"),
      managerUserId: "mgr-b",
      managerGroupId: "mgrgrp:mingsi",
      initiatorDepartment: "ops",
      actorUserId: "mgr-b",
      projectId: project.projectId,
    });

    expect(project.managerGroupId).toBe("mgrgrp:mingsi");
    expect(published.task.managerGroupId).toBe("mgrgrp:mingsi");
    expect(published.task.projectId).toBe(project.projectId);
    expect(store.countTasksForManagerGroup("mgrgrp:mingsi")).toBe(1);
    expect(store.countProjectsForManagerGroup("mgrgrp:mingsi")).toBe(1);

    const groupTasks = store.listManagerTasks({
      managerUserId: "mgr-b",
      managerGroupId: "mgrgrp:mingsi",
    });
    expect(groupTasks).toHaveLength(1);
    expect(groupTasks[0]?.planId).toBe("plan-group-a");

    const filtered = store.listManagerTasks(
      { managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" },
      { projectId: project.projectId },
    );
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.projectId).toBe(project.projectId);

    expect(
      store.listManagerTasks({ managerUserId: "mgr-c", managerGroupId: "mgrgrp:other" }),
    ).toHaveLength(0);
    expect(
      store.getProjectForManagerScope(project.projectId, {
        managerUserId: "mgr-b",
        managerGroupId: "mgrgrp:mingsi",
      })?.projectId,
    ).toBe(project.projectId);
    expect(
      store.getProjectForManagerScope(project.projectId, {
        managerUserId: "mgr-c",
        managerGroupId: "mgrgrp:other",
      }),
    ).toBeUndefined();
    expect(() =>
      store.publishFromSession({
        planId: "plan-group-other",
        session: baseSession("plan-group-other"),
        managerUserId: "mgr-c",
        managerGroupId: "mgrgrp:other",
        initiatorDepartment: "ops",
        actorUserId: "mgr-c",
        projectId: project.projectId,
      }),
    ).toThrow(/Invalid or inaccessible project_id/);
  });

  it("keeps own ungrouped projects accessible after joining a manager group", () => {
    const store = createWorkbenchFormalTaskStore();
    const sameGroup = store.createProject({
      ownerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      name: "Same group project",
    });
    const sameOwnerDifferentGroup = store.createProject({
      ownerUserId: "mgr-b",
      managerGroupId: "mgrgrp:other",
      name: "Same owner different group",
    });
    const sameOwnerUngrouped = store.createProject({
      ownerUserId: "mgr-b",
      name: "Same owner ungrouped",
    });
    const scope = { managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" };

    expect(store.getProjectForManagerScope(sameGroup.projectId, scope)?.projectId).toBe(
      sameGroup.projectId,
    );
    expect(store.getProjectForManagerScope(sameOwnerDifferentGroup.projectId, scope)).toBeUndefined();
    expect(store.getProjectForManagerScope(sameOwnerUngrouped.projectId, scope)?.projectId).toBe(
      sameOwnerUngrouped.projectId,
    );
  });

  it("keeps own ungrouped tasks visible after joining a manager group without leaking other personal tasks", () => {
    const store = createWorkbenchFormalTaskStore();
    store.publishFromSession({
      planId: "plan-group-unassigned",
      session: baseSession("plan-group-unassigned"),
      managerUserId: "mgr-b",
      managerGroupId: "mgrgrp:mingsi",
      initiatorDepartment: "ops",
      actorUserId: "mgr-b",
    });
    store.publishFromSession({
      planId: "plan-other-group-unassigned",
      session: baseSession("plan-other-group-unassigned"),
      managerUserId: "mgr-c",
      managerGroupId: "mgrgrp:other",
      initiatorDepartment: "ops",
      actorUserId: "mgr-c",
    });
    store.publishFromSession({
      planId: "plan-personal-unassigned",
      session: baseSession("plan-personal-unassigned"),
      managerUserId: "mgr-b",
      initiatorDepartment: "ops",
      actorUserId: "mgr-b",
    });
    store.publishFromSession({
      planId: "plan-other-personal-unassigned",
      session: baseSession("plan-other-personal-unassigned"),
      managerUserId: "mgr-a",
      initiatorDepartment: "ops",
      actorUserId: "mgr-a",
    });

    const rows = store.listManagerTasks(
      { managerUserId: "mgr-b", managerGroupId: "mgrgrp:mingsi" },
      { projectId: "__unassigned__" },
    );

    expect(rows.map((row) => row.planId).sort()).toEqual([
      "plan-group-unassigned",
      "plan-personal-unassigned",
    ]);
  });

  it("keeps own ungrouped tasks in performance datasets after joining a manager group", () => {
    const store = createWorkbenchFormalTaskStore();
    const dueSession = (planId: string): PlanSession => {
      const session = baseSession(planId);
      const draft = session.latestDraft as { tasks: Array<{ timeNode?: { dueAt: string } }> };
      draft.tasks[0]!.timeNode = { dueAt: "2026-05-20" };
      return session;
    };
    store.publishFromSession({
      planId: "plan-group-performance",
      session: dueSession("plan-group-performance"),
      managerUserId: "mgr-a",
      managerGroupId: "mgrgrp:mingsi",
      initiatorDepartment: "ops",
      actorUserId: "mgr-a",
    });
    store.publishFromSession({
      planId: "plan-personal-performance",
      session: dueSession("plan-personal-performance"),
      managerUserId: "mgr-b",
      initiatorDepartment: "ops",
      actorUserId: "mgr-b",
    });
    store.publishFromSession({
      planId: "plan-other-personal-performance",
      session: dueSession("plan-other-personal-performance"),
      managerUserId: "mgr-c",
      initiatorDepartment: "ops",
      actorUserId: "mgr-c",
    });

    const dataset = store.loadPerformanceDataset({
      managerUserId: "mgr-b",
      managerGroupId: "mgrgrp:mingsi",
    });

    expect(dataset.subtasks.map((row) => row.planId).sort()).toEqual([
      "plan-group-performance",
      "plan-personal-performance",
    ]);
  });

  it("migrates existing personal tasks and projects into a manager group", () => {
    const store = createWorkbenchFormalTaskStore();
    const project = store.createProject({
      ownerUserId: "manager-1",
      name: "Legacy personal project",
    });
    store.publishFromSession({
      planId: "plan-legacy-personal",
      session: baseSession("plan-legacy-personal"),
      managerUserId: "manager-1",
      initiatorDepartment: "ops",
      actorUserId: "manager-1",
      projectId: project.projectId,
    });
    store.createProject({
      ownerUserId: "manager-2",
      name: "Other manager project",
    });
    store.publishFromSession({
      planId: "plan-other-manager",
      session: baseSession("plan-other-manager"),
      managerUserId: "manager-2",
      initiatorDepartment: "ops",
      actorUserId: "manager-2",
    });

    const result = store.migrateManagerObjectsToGroup({
      managerUserId: "manager-1",
      managerGroupId: "mgrgrp:mingsi",
    });

    expect(result).toEqual({ tasksUpdated: 1, projectsUpdated: 1 });
    expect(store.countTasksForManagerGroup("mgrgrp:mingsi")).toBe(1);
    expect(store.countProjectsForManagerGroup("mgrgrp:mingsi")).toBe(1);
    expect(store.listManagerTasks("manager-1")).toHaveLength(1);
    expect(
      store.listManagerTasks({ managerUserId: "manager-x", managerGroupId: "mgrgrp:mingsi" }),
    ).toHaveLength(1);
    expect(store.listProjectsForOwner("manager-1")).toHaveLength(1);
    expect(
      store.listProjectsForManagerScope({ managerUserId: "manager-x", managerGroupId: "mgrgrp:mingsi" }),
    ).toHaveLength(1);
  });

  it("does not overwrite existing manager_group_id values during migration", () => {
    const store = createWorkbenchFormalTaskStore();
    const existingGroupProject = store.createProject({
      ownerUserId: "manager-1",
      managerGroupId: "mgrgrp:existing",
      name: "Existing group project",
    });
    store.publishFromSession({
      planId: "plan-existing-group",
      session: baseSession("plan-existing-group"),
      managerUserId: "manager-1",
      managerGroupId: "mgrgrp:existing",
      initiatorDepartment: "ops",
      actorUserId: "manager-1",
      projectId: existingGroupProject.projectId,
    });
    const ungroupedProject = store.createProject({
      ownerUserId: "manager-1",
      name: "Ungrouped project",
    });
    store.publishFromSession({
      planId: "plan-ungrouped",
      session: baseSession("plan-ungrouped"),
      managerUserId: "manager-1",
      initiatorDepartment: "ops",
      actorUserId: "manager-1",
      projectId: ungroupedProject.projectId,
    });

    const result = store.migrateManagerObjectsToGroup({
      managerUserId: "manager-1",
      managerGroupId: "mgrgrp:mingsi",
    });

    expect(result).toEqual({ tasksUpdated: 1, projectsUpdated: 1 });
    expect(store.countTasksForManagerGroup("mgrgrp:existing")).toBe(1);
    expect(store.countProjectsForManagerGroup("mgrgrp:existing")).toBe(1);
    expect(store.countTasksForManagerGroup("mgrgrp:mingsi")).toBe(1);
    expect(store.countProjectsForManagerGroup("mgrgrp:mingsi")).toBe(1);
  });

  it("adds nullable manager group columns and indexes when opening legacy databases", () => {
    const temp = mkdtempSync(join(tmpdir(), "formal-store-legacy-manager-group-"));
    const legacyPath = join(temp, "legacy-manager-group.sqlite");
    const raw = new DatabaseSync(legacyPath);
    raw.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        task_no TEXT UNIQUE,
        plan_id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL,
        initiator_user_id TEXT NOT NULL,
        initiator_department TEXT NOT NULL,
        manager_user_id TEXT NOT NULL,
        source_trace_id TEXT,
        published_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        project_id TEXT
      );
      CREATE TABLE projects (
        project_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        owner_user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        aliases_json TEXT,
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
      CREATE TABLE task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        subtask_id TEXT,
        event_type TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        note TEXT,
        payload_json TEXT,
        occurred_at TEXT NOT NULL
      );
      CREATE TABLE permission_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT NOT NULL,
        target_user_id TEXT NOT NULL,
        before_value INTEGER NOT NULL,
        after_value INTEGER NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT
      );
    `);
    raw.close();

    vi.stubEnv("WORKBENCH_SQLITE_PATH", legacyPath);
    createWorkbenchFormalTaskStore();

    const db = new DatabaseSync(legacyPath);
    const taskCols = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const projectCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
    const indexes = db.prepare("PRAGMA index_list(tasks)").all() as Array<{ name: string }>;
    const projectIndexes = db.prepare("PRAGMA index_list(projects)").all() as Array<{ name: string }>;
    expect(taskCols.some((c) => c.name === "manager_group_id")).toBe(true);
    expect(projectCols.some((c) => c.name === "manager_group_id")).toBe(true);
    expect(indexes.some((idx) => idx.name === "idx_tasks_manager_group")).toBe(true);
    expect(projectIndexes.some((idx) => idx.name === "idx_projects_manager_group")).toBe(true);
    db.close();
  });
});
