import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PlanSession } from "./plan-session-store";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";

export type WorkbenchTaskStatus =
  | "ASSIGNED"
  | "CHANGES_REQUESTED"
  | "ACCEPTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "DONE"
  | "REJECTED";

export interface WorkbenchTaskRow {
  taskId: string;
  taskNo: string;
  planId: string;
  title: string;
  status: WorkbenchTaskStatus;
  initiatorUserId: string;
  initiatorDepartment: string;
  managerUserId: string;
  sourceTraceId?: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchSubtaskRow {
  subtaskId: string;
  taskId: string;
  planId: string;
  title: string;
  objective?: string;
  deliverables?: string;
  completionCriteria?: string;
  dueAt?: string;
  feedbackFrequency?: string;
  assigneeUserId: string;
  status: WorkbenchTaskStatus;
  progressNote?: string;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStatus(raw: string): WorkbenchTaskStatus {
  if (raw === "BLOCKED") return "BLOCKED";
  if (raw === "DONE") return "DONE";
  if (raw === "IN_PROGRESS") return "IN_PROGRESS";
  if (raw === "ACCEPTED") return "ACCEPTED";
  if (raw === "CHANGES_REQUESTED") return "CHANGES_REQUESTED";
  if (raw === "REJECTED") return "REJECTED";
  return "ASSIGNED";
}

function aggregateTaskStatus(statuses: WorkbenchTaskStatus[]): WorkbenchTaskStatus {
  if (statuses.some((s) => s === "BLOCKED")) return "BLOCKED";
  if (statuses.length > 0 && statuses.every((s) => s === "DONE")) return "DONE";
  if (statuses.some((s) => s === "IN_PROGRESS")) return "IN_PROGRESS";
  if (statuses.some((s) => s === "ACCEPTED")) return "ACCEPTED";
  if (statuses.some((s) => s === "CHANGES_REQUESTED")) return "CHANGES_REQUESTED";
  if (statuses.some((s) => s === "REJECTED")) return "REJECTED";
  return "ASSIGNED";
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

function asString(v: unknown): string | undefined {
  const normalized = String(v ?? "").trim();
  return normalized || undefined;
}

function stringify(v: unknown): string {
  return JSON.stringify(v ?? null);
}

function inferTitleFromSession(session: PlanSession): string {
  const first = session.conversationHistory?.find((m) => m.role === "user")?.content ?? "";
  const trimmed = first.trim();
  if (!trimmed) return `任务 ${session.planId.slice(0, 8)}`;
  return trimmed.length > 48 ? `${trimmed.slice(0, 48)}...` : trimmed;
}

function extractDraftTasks(latestDraft: unknown): Array<Record<string, unknown>> {
  const draft = asRecord(latestDraft);
  const tasks = draft?.tasks;
  if (!Array.isArray(tasks)) return [];
  return tasks
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function extractAssignmentMap(
  latestAssignment: unknown,
): Map<string, { userId: string; displayName?: string }> {
  const out = new Map<string, { userId: string; displayName?: string }>();
  const assignment = asRecord(latestAssignment);
  const assignments = assignment?.assignments;
  if (!Array.isArray(assignments)) return out;
  assignments.forEach((raw, index) => {
    const row = asRecord(raw);
    if (!row) return;
    const primary = asRecord(row.primary);
    const userId = asString(primary?.userId);
    if (!userId) return;
    const taskId = asString(row.taskId) || `index:${index}`;
    out.set(taskId, { userId, displayName: asString(primary?.displayName) });
  });
  return out;
}

function resolveDbPath(): string {
  return resolveWorkbenchSqlitePath();
}

export function createWorkbenchFormalTaskStore() {
  const dbPath = resolveDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
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
    CREATE TABLE IF NOT EXISTS subtasks (
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
    CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
    CREATE INDEX IF NOT EXISTS idx_subtasks_assignee ON subtasks(assignee_user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_manager ON tasks(manager_user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_department ON tasks(initiator_department);
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
    CREATE INDEX IF NOT EXISTS idx_task_events_task_id ON task_events(task_id);
    CREATE TABLE IF NOT EXISTS permission_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT NOT NULL,
      target_user_id TEXT NOT NULL,
      before_value INTEGER NOT NULL,
      after_value INTEGER NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT
    );
  `);
  const taskColumns = new Set(
    (db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name?: string }>)
      .map((row) => String(row.name ?? "")),
  );
  if (!taskColumns.has("task_no")) {
    db.exec("ALTER TABLE tasks ADD COLUMN task_no TEXT");
  }
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_task_no ON tasks(task_no)");

  const qTaskByPlan = db.prepare("SELECT * FROM tasks WHERE plan_id = ?");
  const qTaskById = db.prepare("SELECT * FROM tasks WHERE task_id = ?");
  const qTaskByNo = db.prepare("SELECT * FROM tasks WHERE task_no = ?");
  const qTaskSubtasks = db.prepare("SELECT * FROM subtasks WHERE task_id = ? ORDER BY subtask_id ASC");
  const qManagerTasks = db.prepare(`
    SELECT
      t.*,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtasks_count,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.status = 'BLOCKED') AS blocked_count
    FROM tasks t
    WHERE t.manager_user_id = ?
    ORDER BY t.updated_at DESC
  `);
  const qEmployeeSubtasks = db.prepare(
    "SELECT s.*, t.task_no, t.plan_id, t.title AS task_title, t.manager_user_id, t.initiator_department FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.assignee_user_id = ? ORDER BY s.updated_at DESC",
  );
  const qAdminTasks = db.prepare(`
    SELECT
      t.*,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtasks_count,
      (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.status = 'BLOCKED') AS blocked_count
    FROM tasks t
    WHERE (? = '' OR t.status = ?)
      AND (? = '' OR t.initiator_department = ?)
      AND (? = '' OR t.task_no = ?)
      AND (? = '' OR t.title LIKE '%' || ? || '%' OR t.plan_id LIKE '%' || ? || '%')
      AND (? = '' OR EXISTS (
        SELECT 1 FROM subtasks s WHERE s.task_id = t.task_id AND s.assignee_user_id = ?
      ))
    ORDER BY t.updated_at DESC
  `);
  const qTaskDetail = db.prepare("SELECT * FROM tasks WHERE task_id = ? OR plan_id = ? OR task_no = ? LIMIT 1");
  const qTaskEvents = db.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 200");
  const qMetrics = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks) AS totalTasks,
      (SELECT COUNT(*) FROM tasks WHERE status IN ('CHANGES_REQUESTED','ACCEPTED','IN_PROGRESS','BLOCKED')) AS activeTasks,
      (SELECT COUNT(*) FROM subtasks WHERE status = 'BLOCKED') AS blockedSubtasks,
      (SELECT COUNT(*) FROM subtasks WHERE status = 'ASSIGNED') AS pendingSubtasks,
      (SELECT COUNT(*) FROM subtasks WHERE status = 'DONE') AS doneSubtasks
  `);
  const qDepartmentMetrics = db.prepare(
    "SELECT initiator_department AS department, COUNT(*) AS count FROM tasks GROUP BY initiator_department ORDER BY count DESC",
  );
  const qAllSubtaskStatuses = db.prepare("SELECT status FROM subtasks WHERE task_id = ?");

  function mapTaskRow(row: Record<string, unknown>): WorkbenchTaskRow {
    return {
      taskId: String(row.task_id ?? ""),
      taskNo: asString(row.task_no) || String(row.task_id ?? ""),
      planId: String(row.plan_id ?? ""),
      title: String(row.title ?? ""),
      status: normalizeStatus(String(row.status ?? "ASSIGNED")),
      initiatorUserId: String(row.initiator_user_id ?? ""),
      initiatorDepartment: String(row.initiator_department ?? ""),
      managerUserId: String(row.manager_user_id ?? ""),
      sourceTraceId: asString(row.source_trace_id),
      publishedAt: String(row.published_at ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  }

  function mapSubtaskRow(row: Record<string, unknown>): WorkbenchSubtaskRow {
    return {
      subtaskId: String(row.subtask_id ?? ""),
      taskId: String(row.task_id ?? ""),
      planId: String(row.plan_id ?? ""),
      title: String(row.title ?? ""),
      objective: asString(row.objective),
      deliverables: asString(row.deliverables),
      completionCriteria: asString(row.completion_criteria),
      dueAt: asString(row.due_at),
      feedbackFrequency: asString(row.feedback_frequency),
      assigneeUserId: String(row.assignee_user_id ?? ""),
      status: normalizeStatus(String(row.status ?? "ASSIGNED")),
      progressNote: asString(row.progress_note),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
    };
  }

  function recalcTaskStatus(taskId: string): WorkbenchTaskStatus {
    const rows = qAllSubtaskStatuses.all(taskId) as Array<Record<string, unknown>>;
    const statuses = rows.map((row) => normalizeStatus(String(row.status ?? "ASSIGNED")));
    return aggregateTaskStatus(statuses);
  }

  function updateTaskStatus(taskId: string): WorkbenchTaskStatus {
    const nextStatus = recalcTaskStatus(taskId);
    const now = nowIso();
    db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?").run(
      nextStatus,
      now,
      taskId,
    );
    return nextStatus;
  }

  function runInTransaction(fn: () => void): void {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  function buildTaskNoForDate(now = new Date()): string {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const datePart = `${y}${m}${d}`;
    const prefix = `TASK-${datePart}-`;
    const latest = db.prepare(
      "SELECT task_no FROM tasks WHERE task_no LIKE ? ORDER BY task_no DESC LIMIT 1",
    ).get(`${prefix}%`) as Record<string, unknown> | undefined;
    const latestNo = asString(latest?.task_no);
    const seq = latestNo ? Number(latestNo.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(seq).padStart(4, "0")}`;
  }

  function resolveDraftTaskDueAt(task: Record<string, unknown>): string | undefined {
    const direct = asString(task.dueAt);
    if (direct) return direct;
    const timeNode = asRecord(task.timeNode);
    return asString(timeNode?.dueAt);
  }

  return {
    publishFromSession(input: {
      planId: string;
      session: PlanSession;
      managerUserId: string;
      initiatorDepartment: string;
      actorUserId: string;
      actorName?: string;
    }): {
      task: WorkbenchTaskRow;
      subtasks: WorkbenchSubtaskRow[];
      alreadyPublished: boolean;
    } {
      const planId = input.planId.trim();
      if (!planId) throw new Error("planId is required");
      const existed = qTaskByPlan.get(planId) as Record<string, unknown> | undefined;
      if (existed) {
        const task = mapTaskRow(existed);
        const subtasks = (qTaskSubtasks.all(task.taskId) as Array<Record<string, unknown>>).map((row) =>
          mapSubtaskRow({ ...row, plan_id: task.planId }),
        );
        return { task, subtasks, alreadyPublished: true };
      }
      const draftTasks = extractDraftTasks(input.session.latestDraft);
      if (draftTasks.length === 0) {
        throw new Error("latestDraft.tasks is empty, cannot publish");
      }
      const assignmentMap = extractAssignmentMap(input.session.latestAssignment);
      const pendingSubtasks = draftTasks.map((draftTask, index) => {
        const sourceKey = asString(draftTask.id) || `index:${index}`;
        const assignee = assignmentMap.get(sourceKey) || assignmentMap.get(`index:${index}`);
        const assigneeUserId = asString(assignee?.userId);
        if (!assigneeUserId) {
          throw new Error(`Missing assignee for subtask ${sourceKey}`);
        }
        return {
          sourceKey,
          title: asString(draftTask.title) || `子任务 ${index + 1}`,
          objective: asString(draftTask.objective),
          deliverables: Array.isArray(draftTask.deliverables)
            ? (draftTask.deliverables as unknown[]).map((x) => String(x)).join("\n")
            : asString(draftTask.deliverables),
          completionCriteria: Array.isArray(draftTask.completionCriteria)
            ? (draftTask.completionCriteria as unknown[]).map((x) => String(x)).join("\n")
            : asString(draftTask.completionCriteria),
          dueAt: resolveDraftTaskDueAt(draftTask),
          feedbackFrequency: asString(draftTask.feedbackFrequency),
          assigneeUserId,
        };
      });
      const taskId = `task:${planId}`;
      const publishedAt = nowIso();
      const taskNo = buildTaskNoForDate();
      const taskTitle = asString((input.session.latestDraft as Record<string, unknown> | undefined)?.title)
        || inferTitleFromSession(input.session);
      runInTransaction(() => {
        db.prepare(
          `INSERT INTO tasks(task_id, task_no, plan_id, title, status, initiator_user_id, initiator_department, manager_user_id, source_trace_id, published_at, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          taskId,
          taskNo,
          planId,
          taskTitle,
          "ASSIGNED",
          asString(input.session.senderStaffId) || input.managerUserId,
          input.initiatorDepartment || "未配置部门",
          input.managerUserId,
          asString(input.session.lastTraceId) || null,
          publishedAt,
          publishedAt,
          publishedAt,
        );
        const insertSubtask = db.prepare(
          `INSERT INTO subtasks(subtask_id, task_id, source_task_key, title, objective, deliverables, completion_criteria, due_at, feedback_frequency, assignee_user_id, status, progress_note, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        pendingSubtasks.forEach((subtask) => {
          const subtaskId = `${taskId}:${subtask.sourceKey}`;
          insertSubtask.run(
            subtaskId,
            taskId,
            subtask.sourceKey,
            subtask.title,
            subtask.objective || null,
            subtask.deliverables || null,
            subtask.completionCriteria || null,
            subtask.dueAt || null,
            subtask.feedbackFrequency || null,
            subtask.assigneeUserId,
            "ASSIGNED",
            null,
            publishedAt,
            publishedAt,
          );
        });
        db.prepare(
          `INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at)
           VALUES(?,?,?,?,?,?,?)`,
        ).run(
          taskId,
          null,
          "TASK_PUBLISHED",
          input.actorUserId,
          input.actorName ? `published by ${input.actorName}` : "published",
          stringify({ planId, taskNo }),
          publishedAt,
        );
      });
      const insertedTask = qTaskById.get(taskId) as Record<string, unknown> | undefined;
      if (!insertedTask) {
        throw new Error("Failed to load published task");
      }
      const task = mapTaskRow(insertedTask);
      const subtasks = (qTaskSubtasks.all(taskId) as Array<Record<string, unknown>>).map((row) =>
        mapSubtaskRow({ ...row, plan_id: task.planId }),
      );
      return { task, subtasks, alreadyPublished: false };
    },

    listManagerTasks(managerUserId: string): Array<WorkbenchTaskRow & {
      subtasksCount: number;
      blockedCount: number;
    }> {
      return (qManagerTasks.all(managerUserId) as Array<Record<string, unknown>>).map((row) => ({
        ...mapTaskRow(row),
        subtasksCount: Number(row.subtasks_count ?? 0),
        blockedCount: Number(row.blocked_count ?? 0),
      }));
    },

    listEmployeeSubtasks(userId: string): Array<
      WorkbenchSubtaskRow & {
        taskNo: string;
        taskTitle: string;
        managerUserId: string;
        initiatorDepartment: string;
      }
    > {
      return (qEmployeeSubtasks.all(userId) as Array<Record<string, unknown>>).map((row) => ({
        ...mapSubtaskRow(row),
        taskNo: asString(row.task_no) || String(row.task_id ?? ""),
        taskTitle: String(row.task_title ?? ""),
        managerUserId: String(row.manager_user_id ?? ""),
        initiatorDepartment: String(row.initiator_department ?? ""),
      }));
    },

    listAdminTasks(filter?: {
      status?: string;
      department?: string;
      taskNo?: string;
      assignee?: string;
      keyword?: string;
    }): Array<WorkbenchTaskRow & {
      subtasksCount: number;
      blockedCount: number;
    }> {
      const status = String(filter?.status ?? "").trim();
      const department = String(filter?.department ?? "").trim();
      const taskNo = String(filter?.taskNo ?? "").trim();
      const assignee = String(filter?.assignee ?? "").trim();
      const keyword = String(filter?.keyword ?? "").trim();
      return (qAdminTasks.all(
        status,
        status,
        department,
        department,
        taskNo,
        taskNo,
        keyword,
        keyword,
        keyword,
        assignee,
        assignee,
      ) as Array<Record<string, unknown>>).map((row) => ({
        ...mapTaskRow(row),
        subtasksCount: Number(row.subtasks_count ?? 0),
        blockedCount: Number(row.blocked_count ?? 0),
      }));
    },

    getTaskDetail(taskKey: string): {
      task: WorkbenchTaskRow;
      subtasks: WorkbenchSubtaskRow[];
      events: Array<Record<string, unknown>>;
    } | undefined {
      const row = qTaskDetail.get(taskKey, taskKey, taskKey) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const task = mapTaskRow(row);
      const subtasks = (qTaskSubtasks.all(task.taskId) as Array<Record<string, unknown>>).map((subtask) =>
        mapSubtaskRow({ ...subtask, plan_id: task.planId }),
      );
      const events = qTaskEvents.all(task.taskId) as Array<Record<string, unknown>>;
      return { task, subtasks, events };
    },

    getSubtaskWithTask(subtaskId: string):
      | { subtask: WorkbenchSubtaskRow; task: WorkbenchTaskRow }
      | undefined {
      const subtaskRow = db
        .prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?")
        .get(subtaskId) as Record<string, unknown> | undefined;
      if (!subtaskRow) return undefined;
      const taskRow = qTaskById.get(String(subtaskRow.task_id ?? "")) as Record<string, unknown> | undefined;
      if (!taskRow) return undefined;
      const task = mapTaskRow(taskRow);
      return {
        task,
        subtask: mapSubtaskRow({ ...subtaskRow, plan_id: task.planId }),
      };
    },

    updateSubtaskStatus(input: {
      subtaskId: string;
      actorUserId: string;
      action: "accept" | "reject" | "request_changes" | "progress";
      note?: string;
      progressStatus?: "IN_PROGRESS" | "BLOCKED" | "DONE";
    }): {
      task: WorkbenchTaskRow;
      subtask: WorkbenchSubtaskRow;
    } {
      const subtask = db.prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?").get(
        input.subtaskId,
      ) as Record<string, unknown> | undefined;
      if (!subtask) throw new Error("Subtask not found");
      const currentAssignee = String(subtask.assignee_user_id ?? "");
      if (currentAssignee !== input.actorUserId) {
        throw new Error("Subtask does not belong to current employee");
      }
      let nextStatus: WorkbenchTaskStatus;
      let eventType = "EMPLOYEE_ACTION";
      if (input.action === "accept") {
        nextStatus = "ACCEPTED";
        eventType = "SUBTASK_ACCEPTED";
      } else if (input.action === "reject") {
        nextStatus = "REJECTED";
        eventType = "SUBTASK_REJECTED";
      } else if (input.action === "request_changes") {
        nextStatus = "CHANGES_REQUESTED";
        eventType = "SUBTASK_CHANGES_REQUESTED";
      } else {
        nextStatus = normalizeStatus(input.progressStatus ?? "IN_PROGRESS");
        eventType = "SUBTASK_PROGRESS";
      }
      const now = nowIso();
      runInTransaction(() => {
        db.prepare("UPDATE subtasks SET status = ?, progress_note = ?, updated_at = ? WHERE subtask_id = ?").run(
          nextStatus,
          input.note?.trim() || null,
          now,
          input.subtaskId,
        );
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          String(subtask.task_id ?? ""),
          input.subtaskId,
          eventType,
          input.actorUserId,
          input.note?.trim() || null,
          stringify({ action: input.action, progressStatus: input.progressStatus }),
          now,
        );
        updateTaskStatus(String(subtask.task_id ?? ""));
      });
      const taskRow = qTaskById.get(String(subtask.task_id ?? "")) as Record<string, unknown> | undefined;
      const subtaskRow = db
        .prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?")
        .get(input.subtaskId) as Record<string, unknown> | undefined;
      if (!taskRow || !subtaskRow) {
        throw new Error("Failed to reload updated rows");
      }
      return {
        task: mapTaskRow(taskRow),
        subtask: mapSubtaskRow(subtaskRow),
      };
    },

    reassignTask(input: {
      planId: string;
      managerUserId: string;
      assigneeUserId: string;
      note?: string;
    }): WorkbenchTaskRow {
      const taskRow = qTaskByPlan.get(input.planId) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("Task not found for planId");
      const task = mapTaskRow(taskRow);
      if (task.managerUserId !== input.managerUserId) {
        throw new Error("Task does not belong to current manager");
      }
      const now = nowIso();
      runInTransaction(() => {
        db.prepare(
          "UPDATE subtasks SET assignee_user_id = ?, status = 'ASSIGNED', updated_at = ? WHERE task_id = ? AND status <> 'DONE'",
        ).run(input.assigneeUserId, now, task.taskId);
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          task.taskId,
          null,
          "MANAGER_REASSIGN",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({ assigneeUserId: input.assigneeUserId }),
          now,
        );
        updateTaskStatus(task.taskId);
      });
      const updated = qTaskById.get(task.taskId) as Record<string, unknown> | undefined;
      if (!updated) throw new Error("Task not found after reassign");
      return mapTaskRow(updated);
    },

    getMetrics(): {
      totalTasks: number;
      activeTasks: number;
      blockedSubtasks: number;
      pendingSubtasks: number;
      doneSubtasks: number;
      byDepartment: Array<{ department: string; count: number }>;
    } {
      const base = (qMetrics.get() as Record<string, unknown> | undefined) ?? {};
      const byDepartment = (qDepartmentMetrics.all() as Array<Record<string, unknown>>).map((row) => ({
        department: String(row.department ?? "未配置部门"),
        count: Number(row.count ?? 0),
      }));
      return {
        totalTasks: Number(base.totalTasks ?? 0),
        activeTasks: Number(base.activeTasks ?? 0),
        blockedSubtasks: Number(base.blockedSubtasks ?? 0),
        pendingSubtasks: Number(base.pendingSubtasks ?? 0),
        doneSubtasks: Number(base.doneSubtasks ?? 0),
        byDepartment,
      };
    },

    appendPermissionEvent(input: {
      actorUserId: string;
      targetUserId: string;
      before: boolean;
      after: boolean;
      payload?: Record<string, unknown>;
    }): void {
      db.prepare(
        "INSERT INTO permission_events(actor_user_id, target_user_id, before_value, after_value, occurred_at, payload_json) VALUES(?,?,?,?,?,?)",
      ).run(
        input.actorUserId,
        input.targetUserId,
        input.before ? 1 : 0,
        input.after ? 1 : 0,
        nowIso(),
        stringify(input.payload),
      );
    },

    appendTaskEvent(input: {
      taskId: string;
      subtaskId?: string;
      eventType: string;
      actorUserId: string;
      note?: string;
      payload?: Record<string, unknown>;
      occurredAt?: string;
    }): void {
      db.prepare(
        "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        input.taskId,
        input.subtaskId ?? null,
        input.eventType,
        input.actorUserId,
        input.note?.trim() || null,
        stringify(input.payload),
        input.occurredAt ?? nowIso(),
      );
    },

    resolveTaskByNo(taskNo: string): WorkbenchTaskRow | undefined {
      const row = qTaskByNo.get(taskNo) as Record<string, unknown> | undefined;
      return row ? mapTaskRow(row) : undefined;
    },
  };
}
