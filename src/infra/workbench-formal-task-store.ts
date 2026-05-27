import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inferConversationTitleFromSession } from "./conversation-present";
import type { PlanSession } from "./plan-session-store";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";
import {
  UNASSIGNED_PROJECT_BUCKET,
  type WorkbenchProjectRow,
  type WorkbenchProjectStatus,
} from "./workbench-project-types";
import { formatDueAtForStorage } from "../agent/reminders/due-at-parse";
import { logStructured } from "./logger";

export type WorkbenchTaskStatus =
  | "ASSIGNED"
  | "CHANGES_REQUESTED"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "DONE"
  | "REJECTED"
  | "STOPPED";

const STOPPABLE_SUBTASK_STATUSES = new Set([
  "ASSIGNED",
  "CHANGES_REQUESTED",
  "IN_PROGRESS",
  "BLOCKED",
  "REJECTED",
]);

/** 发布时写入 `tasks.description`（面向员工的任务整体背景），最大长度见 `TASK_DESCRIPTION_MAX_DB`。 */
export const TASK_DESCRIPTION_MAX_DB = 2000;

export interface WorkbenchTaskRow {
  taskId: string;
  taskNo: string;
  planId: string;
  title: string;
  /** 任务整体背景（来自 draft.description 或 draft.summary） */
  description?: string;
  status: WorkbenchTaskStatus;
  initiatorUserId: string;
  initiatorDepartment: string;
  managerUserId: string;
  sourceTraceId?: string;
  publishedAt: string;
  createdAt: string;
  updatedAt: string;
  /** 大项目归属（可空） */
  projectId?: string;
}

export interface WorkbenchSubtaskRow {
  subtaskId: string;
  taskId: string;
  planId: string;
  /** 对应草案 `tasks[].id`，与 assignment.taskId 对齐 */
  sourceTaskKey: string;
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
  /** 前置依赖任务 ID 列表（JSON 数组字符串）。 */
  dependsOn?: string[];
  checkpoints?: string[];
  risks?: string[];
  inputMaterials?: string[];
  actions?: string[];
  collaborators?: string[];
  inScope?: string[];
  outOfScope?: string[];
}

const RICH_LIST_MAX_ITEMS = 10;
const RICH_ITEM_MAX_CHARS = 200;

function normalizeRichStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (out.length >= RICH_LIST_MAX_ITEMS) break;
    const s = String(item ?? "").trim();
    if (s) out.push(s.length > RICH_ITEM_MAX_CHARS ? s.slice(0, RICH_ITEM_MAX_CHARS) : s);
  }
  return out;
}

function parseRichJsonColumn(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s);
    return normalizeRichStringList(arr);
  } catch {
    logStructured({ event: "workbench_subtask_rich_col_parse_failed", snippet: s.slice(0, 80) });
    return [];
  }
}

function encodeRichJsonColumn(arr: string[]): string | null {
  return arr.length > 0 ? JSON.stringify(arr) : null;
}

/** Add the 8 rich flat columns to subtasks table (idempotent).
 *  Also drops the legacy extra_json column if it still exists (SQLite 3.35+). */
function ensureSubtaskRichColumns(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(subtasks)").all() as Array<{ name?: string }>;
  const existing = new Set(rows.map((r) => String(r.name ?? "")));
  const richCols = [
    "depends_on", "checkpoints", "risks", "input_materials",
    "actions", "collaborators", "in_scope", "out_of_scope",
  ];
  for (const col of richCols) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE subtasks ADD COLUMN ${col} TEXT`);
    }
  }
  if (existing.has("extra_json")) {
    try {
      db.exec("ALTER TABLE subtasks DROP COLUMN extra_json");
    } catch {
      // SQLite < 3.35 fallback: leave extra_json in place (harmless)
    }
  }
}

function ensureSubtaskReminderStateColumns(db: DatabaseSync): void {
  const addColumn = (column: string): void => {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(subtask_reminder_state)").all() as Array<{ name?: string }>)
        .map((row) => String(row.name ?? "")),
    );
    if (columns.has(column)) return;
    try {
      db.exec(`ALTER TABLE subtask_reminder_state ADD COLUMN ${column} TEXT`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.toLowerCase().includes("duplicate column")) throw err;
    }
  };
  addColumn("last_pre_due_reminded_at");
  addColumn("last_manager_overdue_notified_at");
}

function ensureTaskDescriptionColumn(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name?: string }>;
  if (!rows.some((r) => String(r.name ?? "") === "description")) {
    db.exec("ALTER TABLE tasks ADD COLUMN description TEXT");
  }
}

function ensureProjectsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      project_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      aliases_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
  `);
}

function ensureTaskProjectIdColumn(db: DatabaseSync): void {
  const rows = db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name?: string }>;
  if (!rows.some((r) => String(r.name ?? "") === "project_id")) {
    db.exec("ALTER TABLE tasks ADD COLUMN project_id TEXT");
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)");
}

function parseAliasesJson(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = String(raw).trim();
  if (!s) return [];
  try {
    const arr = JSON.parse(s) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 20);
  } catch {
    return [];
  }
}

function mapProjectRow(row: Record<string, unknown>): WorkbenchProjectRow {
  return {
    projectId: String(row.project_id ?? ""),
    name: String(row.name ?? ""),
    description: asString(row.description),
    ownerUserId: String(row.owner_user_id ?? ""),
    status: (String(row.status ?? "active") === "archived" ? "archived" : "active") as WorkbenchProjectStatus,
    aliases: parseAliasesJson(row.aliases_json),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

function clipTaskDescriptionForDb(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  return t.length > TASK_DESCRIPTION_MAX_DB ? t.slice(0, TASK_DESCRIPTION_MAX_DB) : t;
}

/** 从 `latestDraft` 取任务级背景：优先 `description`，否则 `summary`。 */
export function extractTaskDescriptionFromLatestDraft(latestDraft: unknown): string | undefined {
  const draft = asRecord(latestDraft);
  if (!draft) return undefined;
  const fromDesc = asString(draft.description);
  if (fromDesc) return clipTaskDescriptionForDb(fromDesc);
  const fromSummary = asString(draft.summary);
  if (fromSummary) return clipTaskDescriptionForDb(fromSummary);
  return undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeStatus(raw: string): WorkbenchTaskStatus {
  if (raw === "BLOCKED") return "BLOCKED";
  if (raw === "DONE") return "DONE";
  if (raw === "IN_PROGRESS") return "IN_PROGRESS";
  /** Legacy DB / payloads: treat as in execution */
  if (raw === "ACCEPTED") return "IN_PROGRESS";
  /** Product semantics: "待修改" merged into "待处理" (ASSIGNED). */
  if (raw === "CHANGES_REQUESTED") return "ASSIGNED";
  if (raw === "REJECTED") return "REJECTED";
  if (raw === "STOPPED") return "STOPPED";
  return "ASSIGNED";
}

export function isActiveSubtaskStatus(status: WorkbenchTaskStatus): boolean {
  return status !== "DONE" && status !== "STOPPED";
}

/** True when no subtask is in flight and at least one was stopped (task terminated). */
export function taskClosedForAppend(statuses: WorkbenchTaskStatus[]): boolean {
  if (statuses.length === 0) return false;
  const active = statuses.filter(isActiveSubtaskStatus);
  if (active.length > 0) return false;
  return statuses.some((s) => s === "STOPPED");
}

export function aggregateTaskStatus(statuses: WorkbenchTaskStatus[]): WorkbenchTaskStatus {
  if (statuses.length === 0) return "ASSIGNED";
  if (statuses.every((s) => s === "DONE")) return "DONE";
  const active = statuses.filter(isActiveSubtaskStatus);
  if (active.length === 0) {
    if (statuses.some((s) => s === "STOPPED")) return "STOPPED";
    return "DONE";
  }
  if (active.some((s) => s === "BLOCKED")) return "BLOCKED";
  if (active.some((s) => s === "IN_PROGRESS")) return "IN_PROGRESS";
  if (active.some((s) => s === "REJECTED")) return "REJECTED";
  return "ASSIGNED";
}

/** Default 60s; set `WORKBENCH_APPEND_SUBTASK_DEDUP_SECONDS=0` to disable content dedup. */
export function resolveAppendSubtaskDedupSeconds(): number {
  const raw = process.env.WORKBENCH_APPEND_SUBTASK_DEDUP_SECONDS?.trim();
  if (raw === "0") return 0;
  if (!raw) return 60;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 60;
}

export interface AppendSubtaskResult {
  task: WorkbenchTaskRow;
  subtask: WorkbenchSubtaskRow;
  duplicated?: boolean;
}

/** 主管详情「驳回」按钮：与 `managerDeclineSubtaskChanges` 同一套开放信号判定（按单个子任务全量事件，旧→新）。 */
export type SubtaskOpenDeclineKind = "changes" | "rejected";

function replayOpenDeclineKindFromSubtaskEventTypesAsc(typesChronoAsc: readonly string[]): SubtaskOpenDeclineKind | null {
  type Open = "none" | SubtaskOpenDeclineKind;
  let open: Open = "none";
  for (const et of typesChronoAsc) {
    if (et === "SUBTASK_CHANGES_REQUESTED" || et === "SUBTASK_CUSTOMIZE_NOTE") {
      open = "changes";
    } else if (et === "SUBTASK_REJECTED") {
      open = "rejected";
    } else if (et === "MANAGER_DECLINE_CHANGES") {
      open = "none";
    } else if (et === "MANAGER_REASSIGN") {
      open = "none";
    } else if (open === "changes" && et === "SUBTASK_ACCEPTED") {
      open = "none";
    } else if (open === "rejected" && et === "SUBTASK_ACCEPTED") {
      open = "none";
    }
  }
  return open === "none" ? null : open;
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
  return inferConversationTitleFromSession(session);
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
  db.exec("PRAGMA busy_timeout = 8000");

  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS tasks (
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
      depends_on TEXT,
      checkpoints TEXT,
      risks TEXT,
      input_materials TEXT,
      actions TEXT,
      collaborators TEXT,
      in_scope TEXT,
      out_of_scope TEXT,
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
    CREATE INDEX IF NOT EXISTS idx_task_events_occurred_at ON task_events(occurred_at);
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
    CREATE INDEX IF NOT EXISTS idx_dingtalk_contacts_active ON dingtalk_contacts(active);
    CREATE INDEX IF NOT EXISTS idx_dingtalk_contacts_name ON dingtalk_contacts(name);
    CREATE TABLE IF NOT EXISTS subtask_reminder_state (
      subtask_id TEXT PRIMARY KEY,
      overdue_since TEXT NOT NULL,
      last_reminded_at TEXT,
      remind_count INTEGER NOT NULL DEFAULT 0,
      last_tier TEXT,
      last_manual_reminded_at TEXT,
      manual_remind_count INTEGER NOT NULL DEFAULT 0,
      last_scheduler_source_id TEXT,
      last_manual_source_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_due_active
      ON subtasks(status, due_at)
      WHERE status IN ('IN_PROGRESS','BLOCKED');
    CREATE TABLE IF NOT EXISTS progress_digest_state (
      user_id TEXT NOT NULL,
      audience TEXT NOT NULL,
      last_sent_at TEXT,
      last_source_id TEXT,
      PRIMARY KEY (user_id, audience)
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

  ensureSubtaskRichColumns(db);
  ensureTaskDescriptionColumn(db);
  ensureProjectsTable(db);
  ensureTaskProjectIdColumn(db);
  ensureSubtaskReminderStateColumns(db);

  const migratedAt = nowIso();
  db.prepare(
    "UPDATE subtasks SET status = 'IN_PROGRESS', updated_at = ? WHERE status = 'ACCEPTED'",
  ).run(migratedAt);
  db.prepare("UPDATE tasks SET status = 'IN_PROGRESS', updated_at = ? WHERE status = 'ACCEPTED'").run(
    migratedAt,
  );

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
    "SELECT s.*, t.task_no, t.plan_id, t.title AS task_title, t.description AS task_description, t.manager_user_id, t.initiator_department FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.assignee_user_id = ? ORDER BY CASE WHEN s.status = 'REJECTED' THEN 1 ELSE 0 END ASC, s.updated_at DESC",
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
        SELECT 1 FROM subtasks s
        LEFT JOIN dingtalk_contacts c ON c.user_id = s.assignee_user_id
        WHERE s.task_id = t.task_id
        AND (
          s.assignee_user_id = ?
          OR (IFNULL(c.name, '') <> '' AND lower(c.name) LIKE '%' || lower(?) || '%')
        )
      ))
    ORDER BY t.updated_at DESC
  `);
  const qTaskDetail = db.prepare("SELECT * FROM tasks WHERE task_id = ? OR plan_id = ? OR task_no = ? LIMIT 1");
  const qTaskEvents = db.prepare("SELECT * FROM task_events WHERE task_id = ? ORDER BY id DESC LIMIT 200");
  /** 单个子任务事件（旧→新）；用于驳回开放态判定，避免被任务级 `LIMIT 200` 时间线截断。 */
  const qSubtaskEventTypesAsc = db.prepare(
    "SELECT event_type FROM task_events WHERE subtask_id = ? ORDER BY id ASC LIMIT 5000",
  );
  const qMetrics = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tasks) AS totalTasks,
      (SELECT COUNT(*) FROM tasks WHERE status IN ('CHANGES_REQUESTED','IN_PROGRESS','BLOCKED')) AS activeTasks,
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
      description: asString(row.description),
      status: normalizeStatus(String(row.status ?? "ASSIGNED")),
      initiatorUserId: String(row.initiator_user_id ?? ""),
      initiatorDepartment: String(row.initiator_department ?? ""),
      managerUserId: String(row.manager_user_id ?? ""),
      sourceTraceId: asString(row.source_trace_id),
      publishedAt: String(row.published_at ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      projectId: asString(row.project_id),
    };
  }

  function mapSubtaskRow(row: Record<string, unknown>): WorkbenchSubtaskRow {
    const dependsOn = parseRichJsonColumn(row.depends_on);
    const checkpoints = parseRichJsonColumn(row.checkpoints);
    const risks = parseRichJsonColumn(row.risks);
    const inputMaterials = parseRichJsonColumn(row.input_materials);
    const actions = parseRichJsonColumn(row.actions);
    const collaborators = parseRichJsonColumn(row.collaborators);
    const inScope = parseRichJsonColumn(row.in_scope);
    const outOfScope = parseRichJsonColumn(row.out_of_scope);
    return {
      subtaskId: String(row.subtask_id ?? ""),
      taskId: String(row.task_id ?? ""),
      planId: String(row.plan_id ?? ""),
      sourceTaskKey: String(row.source_task_key ?? ""),
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
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
      ...(checkpoints.length > 0 ? { checkpoints } : {}),
      ...(risks.length > 0 ? { risks } : {}),
      ...(inputMaterials.length > 0 ? { inputMaterials } : {}),
      ...(actions.length > 0 ? { actions } : {}),
      ...(collaborators.length > 0 ? { collaborators } : {}),
      ...(inScope.length > 0 ? { inScope } : {}),
      ...(outOfScope.length > 0 ? { outOfScope } : {}),
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
      /** 大项目 id；非 portfolio 路径应省略，落库为 NULL */
      projectId?: string | null;
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
        const timeNode = draftTask.timeNode as Record<string, unknown> | undefined;
        const depsRaw = draftTask.dependencyTaskIds ?? draftTask.dependencies;
        const scopeRaw = draftTask.scope as Record<string, unknown> | undefined;
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
          dueAt: formatDueAtForStorage(resolveDraftTaskDueAt(draftTask)),
          feedbackFrequency: asString(draftTask.feedbackFrequency),
          assigneeUserId,
          dependsOn: encodeRichJsonColumn(normalizeRichStringList(depsRaw)),
          checkpoints: encodeRichJsonColumn(normalizeRichStringList(timeNode?.checkpoints)),
          risks: encodeRichJsonColumn(normalizeRichStringList(draftTask.risksAndOpenQuestions)),
          inputMaterials: encodeRichJsonColumn(normalizeRichStringList(draftTask.inputMaterials)),
          actions: encodeRichJsonColumn(normalizeRichStringList(draftTask.actions)),
          collaborators: encodeRichJsonColumn(normalizeRichStringList(draftTask.collaborators)),
          inScope: encodeRichJsonColumn(normalizeRichStringList(scopeRaw?.inScope)),
          outOfScope: encodeRichJsonColumn(normalizeRichStringList(scopeRaw?.outOfScope)),
        };
      });
      const taskId = `task:${planId}`;
      const publishedAt = nowIso();
      const taskNo = buildTaskNoForDate();
      const taskTitle = asString((input.session.latestDraft as Record<string, unknown> | undefined)?.title)
        || inferTitleFromSession(input.session);
      const taskDescription = extractTaskDescriptionFromLatestDraft(input.session.latestDraft);
      const rawProjectId = String(input.projectId ?? "").trim();
      let resolvedProjectId: string | null = null;
      if (rawProjectId) {
        const proj = db
          .prepare(
            "SELECT * FROM projects WHERE project_id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1",
          )
          .get(rawProjectId, input.managerUserId.trim()) as Record<string, unknown> | undefined;
        if (!proj) {
          throw new Error(`Invalid or inaccessible project_id: ${rawProjectId}`);
        }
        resolvedProjectId = rawProjectId;
      }
      runInTransaction(() => {
        db.prepare(
          `INSERT INTO tasks(task_id, task_no, plan_id, title, description, status, initiator_user_id, initiator_department, manager_user_id, source_trace_id, published_at, created_at, updated_at, project_id)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          taskId,
          taskNo,
          planId,
          taskTitle,
          taskDescription ?? null,
          "ASSIGNED",
          asString(input.session.senderStaffId) || input.managerUserId,
          input.initiatorDepartment || "未配置部门",
          input.managerUserId,
          asString(input.session.lastTraceId) || null,
          publishedAt,
          publishedAt,
          publishedAt,
          resolvedProjectId,
        );
        const insertSubtask = db.prepare(
          `INSERT INTO subtasks(subtask_id, task_id, source_task_key, title, objective, deliverables, completion_criteria, due_at, feedback_frequency, assignee_user_id, status, progress_note, created_at, updated_at, depends_on, checkpoints, risks, input_materials, actions, collaborators, in_scope, out_of_scope)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
            subtask.dependsOn,
            subtask.checkpoints,
            subtask.risks,
            subtask.inputMaterials,
            subtask.actions,
            subtask.collaborators,
            subtask.inScope,
            subtask.outOfScope,
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

    listManagerTasks(
      managerUserId: string,
      filter?: { projectId?: string },
    ): Array<WorkbenchTaskRow & {
      subtasksCount: number;
      blockedCount: number;
    }> {
      const mid = managerUserId.trim();
      const pid = String(filter?.projectId ?? "").trim();
      let rows: Array<Record<string, unknown>>;
      if (pid === UNASSIGNED_PROJECT_BUCKET) {
        rows = db
          .prepare(
            `SELECT t.*,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtasks_count,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.status = 'BLOCKED') AS blocked_count
             FROM tasks t
             WHERE t.manager_user_id = ? AND (t.project_id IS NULL OR t.project_id = '')
             ORDER BY t.updated_at DESC`,
          )
          .all(mid) as Array<Record<string, unknown>>;
      } else if (pid) {
        rows = db
          .prepare(
            `SELECT t.*,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtasks_count,
              (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.status = 'BLOCKED') AS blocked_count
             FROM tasks t
             WHERE t.manager_user_id = ? AND t.project_id = ?
             ORDER BY t.updated_at DESC`,
          )
          .all(mid, pid) as Array<Record<string, unknown>>;
      } else {
        rows = qManagerTasks.all(mid) as Array<Record<string, unknown>>;
      }
      return rows.map((row) => ({
        ...mapTaskRow(row),
        subtasksCount: Number(row.subtasks_count ?? 0),
        blockedCount: Number(row.blocked_count ?? 0),
      }));
    },

    createProject(input: {
      ownerUserId: string;
      name: string;
      description?: string;
      aliases?: string[];
    }): WorkbenchProjectRow {
      const name = input.name.trim();
      if (!name) throw new Error("project name is required");
      const ownerUserId = input.ownerUserId.trim();
      if (!ownerUserId) throw new Error("ownerUserId is required");
      const now = nowIso();
      const projectId = `proj:${randomUUID()}`;
      const aliases = normalizeRichStringList(input.aliases ?? []).slice(0, 10);
      db.prepare(
        `INSERT INTO projects(project_id, name, description, owner_user_id, status, aliases_json, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      ).run(
        projectId,
        name,
        asString(input.description) ?? null,
        ownerUserId,
        "active",
        aliases.length > 0 ? JSON.stringify(aliases) : null,
        now,
        now,
      );
      const row = db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new Error("Failed to create project");
      return mapProjectRow(row);
    },

    updateProject(input: {
      projectId: string;
      ownerUserId: string;
      name?: string;
      description?: string;
      status?: WorkbenchProjectStatus;
      aliases?: string[];
    }): WorkbenchProjectRow {
      const projectId = input.projectId.trim();
      const ownerUserId = input.ownerUserId.trim();
      const existing = db
        .prepare("SELECT * FROM projects WHERE project_id = ? AND owner_user_id = ? LIMIT 1")
        .get(projectId, ownerUserId) as Record<string, unknown> | undefined;
      if (!existing) throw new Error("project not found");
      const now = nowIso();
      const name = input.name !== undefined ? input.name.trim() : String(existing.name ?? "");
      if (!name) throw new Error("project name is required");
      const description =
        input.description !== undefined ? asString(input.description) ?? null : asString(existing.description) ?? null;
      const status =
        input.status === "archived" || input.status === "active"
          ? input.status
          : (String(existing.status ?? "active") === "archived" ? "archived" : "active");
      const aliases =
        input.aliases !== undefined
          ? JSON.stringify(normalizeRichStringList(input.aliases).slice(0, 10))
          : existing.aliases_json != null
            ? String(existing.aliases_json)
            : null;
      db.prepare(
        "UPDATE projects SET name = ?, description = ?, status = ?, aliases_json = ?, updated_at = ? WHERE project_id = ?",
      ).run(name, description, status, aliases, now, projectId);
      const row = db.prepare("SELECT * FROM projects WHERE project_id = ?").get(projectId) as
        | Record<string, unknown>
        | undefined;
      if (!row) throw new Error("Failed to update project");
      return mapProjectRow(row);
    },

    getProject(projectId: string, ownerUserId: string): WorkbenchProjectRow | undefined {
      const row = db
        .prepare("SELECT * FROM projects WHERE project_id = ? AND owner_user_id = ? LIMIT 1")
        .get(projectId.trim(), ownerUserId.trim()) as Record<string, unknown> | undefined;
      return row ? mapProjectRow(row) : undefined;
    },

    listProjectsForOwner(ownerUserId: string): WorkbenchProjectRow[] {
      const rows = db
        .prepare(
          "SELECT * FROM projects WHERE owner_user_id = ? ORDER BY CASE WHEN status = 'archived' THEN 1 ELSE 0 END, updated_at DESC",
        )
        .all(ownerUserId.trim()) as Array<Record<string, unknown>>;
      return rows.map((row) => mapProjectRow(row));
    },

    setTaskProject(input: {
      taskNo: string;
      managerUserId: string;
      projectId: string | null;
    }): WorkbenchTaskRow {
      const taskNo = input.taskNo.trim();
      const managerUserId = input.managerUserId.trim();
      const taskRow = qTaskByNo.get(taskNo) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("task not found");
      if (String(taskRow.manager_user_id ?? "").trim() !== managerUserId) {
        throw new Error("task not managed by actor");
      }
      let resolved: string | null = null;
      const pid = input.projectId === null ? "" : String(input.projectId ?? "").trim();
      if (pid && pid !== UNASSIGNED_PROJECT_BUCKET) {
        const proj = db
          .prepare(
            "SELECT project_id FROM projects WHERE project_id = ? AND owner_user_id = ? AND status = 'active' LIMIT 1",
          )
          .get(pid, managerUserId) as Record<string, unknown> | undefined;
        if (!proj) throw new Error("Invalid or inaccessible project_id");
        resolved = pid;
      }
      const now = nowIso();
      db.prepare("UPDATE tasks SET project_id = ?, updated_at = ? WHERE task_id = ?").run(
        resolved,
        now,
        String(taskRow.task_id ?? ""),
      );
      const updated = qTaskByNo.get(taskNo) as Record<string, unknown> | undefined;
      if (!updated) throw new Error("Failed to load task");
      return mapTaskRow(updated);
    },

    listEmployeeSubtasks(userId: string): Array<
      WorkbenchSubtaskRow & {
        taskNo: string;
        taskTitle: string;
        taskDescription?: string;
        managerUserId: string;
        initiatorDepartment: string;
      }
    > {
      return (qEmployeeSubtasks.all(userId) as Array<Record<string, unknown>>).map((row) => ({
        ...mapSubtaskRow(row),
        taskNo: asString(row.task_no) || String(row.task_id ?? ""),
        taskTitle: String(row.task_title ?? ""),
        taskDescription: asString(row.task_description),
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

    getSubtaskOpenDeclineKind(subtaskId: string): SubtaskOpenDeclineKind | null {
      const sid = String(subtaskId ?? "").trim();
      if (!sid) return null;
      const rows = qSubtaskEventTypesAsc.all(sid) as Array<{ event_type?: unknown }>;
      const types = rows.map((r) => String(r.event_type ?? ""));
      return replayOpenDeclineKindFromSubtaskEventTypesAsc(types);
    },

    updateSubtaskStatus(input: {
      subtaskId: string;
      actorUserId: string;
      action: "accept" | "reject" | "request_changes" | "customize" | "progress";
      note?: string;
      progressStatus?: "IN_PROGRESS" | "BLOCKED" | "DONE";
    }): {
      task: WorkbenchTaskRow;
      subtask: WorkbenchSubtaskRow;
      previousStatus: WorkbenchTaskStatus;
    } {
      const subtask = db.prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?").get(
        input.subtaskId,
      ) as Record<string, unknown> | undefined;
      if (!subtask) throw new Error("Subtask not found");
      const currentAssignee = String(subtask.assignee_user_id ?? "");
      if (currentAssignee !== input.actorUserId) {
        throw new Error("Subtask does not belong to current employee");
      }
      const previousStatus = normalizeStatus(String(subtask.status ?? "ASSIGNED"));
      if (previousStatus === "STOPPED") {
        throw new Error("Subtask has been stopped by manager");
      }
      let nextStatus: WorkbenchTaskStatus;
      let eventType = "EMPLOYEE_ACTION";
      if (input.action === "accept") {
        nextStatus = "IN_PROGRESS";
        eventType = "SUBTASK_ACCEPTED";
      } else if (input.action === "reject") {
        nextStatus = "REJECTED";
        eventType = "SUBTASK_REJECTED";
      } else if (input.action === "request_changes") {
        nextStatus = "ASSIGNED";
        eventType = "SUBTASK_CHANGES_REQUESTED";
      } else if (input.action === "customize") {
        nextStatus = normalizeStatus(String(subtask.status ?? "ASSIGNED"));
        eventType = "SUBTASK_CUSTOMIZE_NOTE";
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
        previousStatus,
      };
    },

    managerDeclineSubtaskChanges(input: {
      subtaskId: string;
      managerUserId: string;
      note?: string;
    }): {
      task: WorkbenchTaskRow;
      subtask: WorkbenchSubtaskRow;
    } {
      const subtask = db
        .prepare(
          "SELECT s.*, t.plan_id, t.manager_user_id, t.task_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?",
        )
        .get(input.subtaskId) as Record<string, unknown> | undefined;
      if (!subtask) throw new Error("Subtask not found");
      if (String(subtask.manager_user_id ?? "").trim() !== input.managerUserId.trim()) {
        throw new Error("Task does not belong to current manager");
      }
      const types = (qSubtaskEventTypesAsc.all(input.subtaskId) as Array<{ event_type?: unknown }>).map((r) =>
        String(r.event_type ?? ""),
      );
      const open = replayOpenDeclineKindFromSubtaskEventTypesAsc(types);
      if (!open) {
        throw new Error("没有待处理的调整申请或拒绝承接记录");
      }
      const now = nowIso();
      const taskId = String(subtask.task_id ?? "");
      runInTransaction(() => {
        db.prepare("UPDATE subtasks SET status = 'IN_PROGRESS', updated_at = ? WHERE subtask_id = ?").run(
          now,
          input.subtaskId,
        );
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          taskId,
          input.subtaskId,
          "MANAGER_DECLINE_CHANGES",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({}),
          now,
        );
        updateTaskStatus(taskId);
      });
      const taskRow = qTaskById.get(taskId) as Record<string, unknown> | undefined;
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

    managerAcknowledgeSubtaskSignal(input: {
      subtaskId: string;
      managerUserId: string;
      signal: string;
      note?: string;
    }): void {
      const row = db
        .prepare(
          "SELECT s.subtask_id, t.task_id, t.manager_user_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?",
        )
        .get(input.subtaskId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("Subtask not found");
      if (String(row.manager_user_id ?? "").trim() !== input.managerUserId.trim()) {
        throw new Error("Task does not belong to current manager");
      }
      const taskId = String(row.task_id ?? "");
      const now = nowIso();
      db.prepare(
        "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
      ).run(
        taskId,
        input.subtaskId,
        "MANAGER_ACK_SUBTASK_SIGNAL",
        input.managerUserId,
        input.note?.trim() || null,
        stringify({ signal: input.signal }),
        now,
      );
    },

    stopSubtask(input: {
      planId: string;
      subtaskId: string;
      managerUserId: string;
      note?: string;
      actorName?: string;
    }): {
      task: WorkbenchTaskRow;
      subtask: WorkbenchSubtaskRow;
      alreadyStopped: boolean;
    } {
      const taskRow = qTaskByPlan.get(input.planId) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("Task not found for planId");
      const task = mapTaskRow(taskRow);
      if (task.managerUserId !== input.managerUserId) {
        throw new Error("Task does not belong to current manager");
      }
      const subtaskRow = db
        .prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ? AND s.task_id = ?")
        .get(input.subtaskId, task.taskId) as Record<string, unknown> | undefined;
      if (!subtaskRow) throw new Error(`subtask not found: ${input.subtaskId}`);
      const currentStatus = String(subtaskRow.status ?? "");
      if (currentStatus === "STOPPED") {
        return {
          task,
          subtask: mapSubtaskRow(subtaskRow),
          alreadyStopped: true,
        };
      }
      if (!STOPPABLE_SUBTASK_STATUSES.has(currentStatus)) {
        throw new Error(`subtask cannot be stopped in status ${currentStatus}`);
      }
      const now = nowIso();
      runInTransaction(() => {
        db.prepare("UPDATE subtasks SET status = 'STOPPED', updated_at = ? WHERE subtask_id = ?").run(
          now,
          input.subtaskId,
        );
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          task.taskId,
          input.subtaskId,
          "SUBTASK_STOPPED",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({ actorName: input.actorName }),
          now,
        );
        updateTaskStatus(task.taskId);
      });
      const updatedTaskRow = qTaskById.get(task.taskId) as Record<string, unknown> | undefined;
      const updatedSubtaskRow = db
        .prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?")
        .get(input.subtaskId) as Record<string, unknown> | undefined;
      if (!updatedTaskRow || !updatedSubtaskRow) {
        throw new Error("Failed to reload rows after stop subtask");
      }
      return {
        task: mapTaskRow(updatedTaskRow),
        subtask: mapSubtaskRow(updatedSubtaskRow),
        alreadyStopped: false,
      };
    },

    stopTask(input: {
      planId: string;
      managerUserId: string;
      note?: string;
      actorName?: string;
    }): {
      task: WorkbenchTaskRow;
      subtasks: WorkbenchSubtaskRow[];
      stoppedSubtaskIds: string[];
      alreadyStopped: boolean;
    } {
      const taskRow = qTaskByPlan.get(input.planId) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("Task not found for planId");
      const task = mapTaskRow(taskRow);
      if (task.managerUserId !== input.managerUserId) {
        throw new Error("Task does not belong to current manager");
      }
      const subtaskRows = qTaskSubtasks.all(task.taskId) as Array<Record<string, unknown>>;
      const toStop = subtaskRows.filter((row) =>
        STOPPABLE_SUBTASK_STATUSES.has(String(row.status ?? "")),
      );
      if (toStop.length === 0) {
        const subtasks = subtaskRows.map((row) => mapSubtaskRow({ ...row, plan_id: task.planId }));
        return { task, subtasks, stoppedSubtaskIds: [], alreadyStopped: true };
      }
      const now = nowIso();
      const stoppedSubtaskIds: string[] = [];
      runInTransaction(() => {
        for (const row of toStop) {
          const subtaskId = String(row.subtask_id ?? "");
          db.prepare("UPDATE subtasks SET status = 'STOPPED', updated_at = ? WHERE subtask_id = ?").run(
            now,
            subtaskId,
          );
          stoppedSubtaskIds.push(subtaskId);
          db.prepare(
            "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
          ).run(
            task.taskId,
            subtaskId,
            "SUBTASK_STOPPED",
            input.managerUserId,
            input.note?.trim() || null,
            stringify({ actorName: input.actorName }),
            now,
          );
        }
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          task.taskId,
          null,
          "TASK_STOPPED",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({ stoppedSubtaskIds, actorName: input.actorName }),
          now,
        );
        updateTaskStatus(task.taskId);
      });
      const updatedTaskRow = qTaskById.get(task.taskId) as Record<string, unknown> | undefined;
      if (!updatedTaskRow) throw new Error("Task not found after stop");
      const subtasks = (qTaskSubtasks.all(task.taskId) as Array<Record<string, unknown>>).map((row) =>
        mapSubtaskRow({ ...row, plan_id: task.planId }),
      );
      return {
        task: mapTaskRow(updatedTaskRow),
        subtasks,
        stoppedSubtaskIds,
        alreadyStopped: false,
      };
    },

    appendSubtask(input: {
      planId: string;
      managerUserId: string;
      title: string;
      assigneeUserId: string;
      objective?: string;
      deliverables?: string;
      completionCriteria?: string;
      dueAt?: string;
      feedbackFrequency?: string;
      dependsOn?: string[];
      checkpoints?: string[];
      risks?: string[];
      inputMaterials?: string[];
      actions?: string[];
      collaborators?: string[];
      inScope?: string[];
      outOfScope?: string[];
      note?: string;
      actorName?: string;
    }): AppendSubtaskResult {
      const taskRow = qTaskByPlan.get(input.planId) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("Task not found for planId");
      const task = mapTaskRow(taskRow);
      if (task.managerUserId !== input.managerUserId) {
        throw new Error("Task does not belong to current manager");
      }
      const existingSubtaskRows = qTaskSubtasks.all(task.taskId) as Array<Record<string, unknown>>;
      const existingStatuses = existingSubtaskRows.map((row) =>
        normalizeStatus(String(row.status ?? "ASSIGNED")),
      );
      if (taskClosedForAppend(existingStatuses)) {
        throw new Error("Cannot append subtask to a stopped task");
      }
      const title = input.title.trim();
      if (!title) throw new Error("title is required");
      const assigneeUserId = input.assigneeUserId.trim();
      if (!assigneeUserId) throw new Error("assigneeUserId is required");
      const objective = input.objective?.trim();
      if (!objective) throw new Error("objective is required");
      const deliverables = input.deliverables?.trim();
      if (!deliverables) throw new Error("deliverables is required");
      const completionCriteria = input.completionCriteria?.trim();
      if (!completionCriteria) throw new Error("completionCriteria is required");
      if (!input.dueAt?.trim()) throw new Error("dueAt is required");

      const dueAt = formatDueAtForStorage(input.dueAt);
      const dedupSeconds = resolveAppendSubtaskDedupSeconds();
      if (dedupSeconds > 0) {
        const cutoff = new Date(Date.now() - dedupSeconds * 1000).toISOString();
        const dupRow = db
          .prepare(
            `SELECT s.*, t.plan_id FROM subtasks s
             JOIN tasks t ON t.task_id = s.task_id
             WHERE s.task_id = ?
               AND s.title = ?
               AND s.assignee_user_id = ?
               AND s.objective = ?
               AND s.deliverables = ?
               AND s.completion_criteria = ?
               AND COALESCE(s.due_at, '') = COALESCE(?, '')
               AND s.status NOT IN ('DONE', 'STOPPED')
               AND s.created_at >= ?
             ORDER BY s.created_at DESC
             LIMIT 1`,
          )
          .get(
            task.taskId,
            title,
            assigneeUserId,
            objective,
            deliverables,
            completionCriteria,
            dueAt || null,
            cutoff,
          ) as Record<string, unknown> | undefined;
        if (dupRow) {
          const updatedTaskRow = qTaskById.get(task.taskId) as Record<string, unknown> | undefined;
          if (!updatedTaskRow) throw new Error("Failed to reload task after duplicate appendSubtask");
          return {
            task: mapTaskRow(updatedTaskRow),
            subtask: mapSubtaskRow(dupRow),
            duplicated: true,
          };
        }
      }

      const sourceTaskKey = `manual-${randomUUID().slice(0, 8)}`;
      const subtaskId = `${task.taskId}:${sourceTaskKey}`;
      const now = nowIso();

      runInTransaction(() => {
        db.prepare(
          `INSERT INTO subtasks(subtask_id, task_id, source_task_key, title, objective, deliverables, completion_criteria, due_at, feedback_frequency, assignee_user_id, status, progress_note, created_at, updated_at, depends_on, checkpoints, risks, input_materials, actions, collaborators, in_scope, out_of_scope)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          subtaskId,
          task.taskId,
          sourceTaskKey,
          title,
          objective,
          deliverables,
          completionCriteria,
          dueAt || null,
          input.feedbackFrequency?.trim() || null,
          assigneeUserId,
          "ASSIGNED",
          null,
          now,
          now,
          encodeRichJsonColumn(normalizeRichStringList(input.dependsOn)),
          encodeRichJsonColumn(normalizeRichStringList(input.checkpoints)),
          encodeRichJsonColumn(normalizeRichStringList(input.risks)),
          encodeRichJsonColumn(normalizeRichStringList(input.inputMaterials)),
          encodeRichJsonColumn(normalizeRichStringList(input.actions)),
          encodeRichJsonColumn(normalizeRichStringList(input.collaborators)),
          encodeRichJsonColumn(normalizeRichStringList(input.inScope)),
          encodeRichJsonColumn(normalizeRichStringList(input.outOfScope)),
        );
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          task.taskId,
          subtaskId,
          "SUBTASK_ADDED",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({
            assigneeUserId,
            sourceTaskKey,
            actorName: input.actorName,
          }),
          now,
        );
        updateTaskStatus(task.taskId);
      });

      const updatedTaskRow = qTaskById.get(task.taskId) as Record<string, unknown> | undefined;
      const subtaskRow = db
        .prepare("SELECT s.*, t.plan_id FROM subtasks s JOIN tasks t ON t.task_id = s.task_id WHERE s.subtask_id = ?")
        .get(subtaskId) as Record<string, unknown> | undefined;
      if (!updatedTaskRow || !subtaskRow) {
        throw new Error("Failed to reload rows after append subtask");
      }
      return {
        task: mapTaskRow(updatedTaskRow),
        subtask: mapSubtaskRow(subtaskRow),
        duplicated: false,
      };
    },

    reassignTask(input: {
      planId: string;
      managerUserId: string;
      assigneeUserId: string;
      note?: string;
      /**
       * 可选：仅改派指定子任务。
       * - 不传 → 整 plan 改派（所有未完成子任务，向后兼容旧行为）
       * - 传短码（如 "task_4"） → 自动拼成 "task:{planId}:task_4"
       * - 传完整形（"task:{planId}:task_4"） → 原样使用
       */
      subtaskId?: string;
    }): WorkbenchTaskRow {
      const taskRow = qTaskByPlan.get(input.planId) as Record<string, unknown> | undefined;
      if (!taskRow) throw new Error("Task not found for planId");
      const task = mapTaskRow(taskRow);
      if (task.managerUserId !== input.managerUserId) {
        throw new Error("Task does not belong to current manager");
      }

      const rawSubtaskId = input.subtaskId?.trim();
      const normalizedSubtaskId = rawSubtaskId
        ? rawSubtaskId.startsWith("task:")
          ? rawSubtaskId
          : `task:${input.planId}:${rawSubtaskId}`
        : undefined;
      if (normalizedSubtaskId) {
        const probe = db
          .prepare(
            "SELECT subtask_id, status FROM subtasks WHERE task_id = ? AND subtask_id = ?",
          )
          .get(task.taskId, normalizedSubtaskId) as
          | { subtask_id: string; status: string }
          | undefined;
        if (!probe) {
          throw new Error(
            `subtask not found: ${normalizedSubtaskId} (under plan ${input.planId})`,
          );
        }
        if (probe.status === "DONE") {
          throw new Error(
            `subtask already DONE; cannot reassign: ${normalizedSubtaskId}`,
          );
        }
        if (probe.status === "STOPPED") {
          throw new Error(
            `subtask already STOPPED; cannot reassign: ${normalizedSubtaskId}`,
          );
        }
      }

      const now = nowIso();
      runInTransaction(() => {
        if (normalizedSubtaskId) {
          db.prepare(
            "UPDATE subtasks SET assignee_user_id = ?, status = 'ASSIGNED', updated_at = ? WHERE task_id = ? AND subtask_id = ? AND status NOT IN ('DONE','STOPPED')",
          ).run(input.assigneeUserId, now, task.taskId, normalizedSubtaskId);
        } else {
          db.prepare(
            "UPDATE subtasks SET assignee_user_id = ?, status = 'ASSIGNED', updated_at = ? WHERE task_id = ? AND status NOT IN ('DONE','STOPPED')",
          ).run(input.assigneeUserId, now, task.taskId);
        }
        db.prepare(
          "INSERT INTO task_events(task_id, subtask_id, event_type, actor_user_id, note, payload_json, occurred_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          task.taskId,
          normalizedSubtaskId ?? null,
          "MANAGER_REASSIGN",
          input.managerUserId,
          input.note?.trim() || null,
          stringify({
            assigneeUserId: input.assigneeUserId,
            ...(normalizedSubtaskId ? { subtaskId: normalizedSubtaskId } : {}),
          }),
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

    listActiveSubtasksForReminders(): Array<{
      subtaskId: string;
      taskId: string;
      planId: string;
      taskNo: string;
      title: string;
      subtaskTitle: string;
      sourceTaskKey: string;
      dueAt?: string;
      status: WorkbenchTaskStatus;
      assigneeUserId: string;
      managerUserId: string;
      updatedAt: string;
    }> {
      const rows = db
        .prepare(
          `SELECT s.subtask_id, s.task_id, s.source_task_key, s.title AS subtask_title, s.due_at, s.status,
                  s.assignee_user_id, s.updated_at,
                  t.plan_id, t.task_no, t.title AS task_title, t.manager_user_id
             FROM subtasks s
             JOIN tasks t ON t.task_id = s.task_id
            WHERE s.status IN ('IN_PROGRESS','BLOCKED')`,
        )
        .all() as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        subtaskId: String(row.subtask_id ?? ""),
        taskId: String(row.task_id ?? ""),
        planId: String(row.plan_id ?? ""),
        taskNo: asString(row.task_no) || String(row.task_id ?? ""),
        title: String(row.task_title ?? ""),
        subtaskTitle: String(row.subtask_title ?? ""),
        sourceTaskKey: String(row.source_task_key ?? ""),
        dueAt: asString(row.due_at),
        status: normalizeStatus(String(row.status ?? "IN_PROGRESS")),
        assigneeUserId: String(row.assignee_user_id ?? ""),
        managerUserId: String(row.manager_user_id ?? ""),
        updatedAt: String(row.updated_at ?? ""),
      }));
    },

    getSubtaskReminderState(subtaskId: string):
      | {
          overdueSince: string;
          lastRemindedAt?: string;
          remindCount: number;
          lastTier?: string;
          lastManualRemindedAt?: string;
          manualRemindCount: number;
          lastPreDueRemindedAt?: string;
          lastManagerOverdueNotifiedAt?: string;
        }
      | undefined {
      const row = db
        .prepare("SELECT * FROM subtask_reminder_state WHERE subtask_id = ?")
        .get(subtaskId) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        overdueSince: String(row.overdue_since ?? ""),
        lastRemindedAt: asString(row.last_reminded_at),
        remindCount: Number(row.remind_count ?? 0),
        lastTier: asString(row.last_tier),
        lastManualRemindedAt: asString(row.last_manual_reminded_at),
        manualRemindCount: Number(row.manual_remind_count ?? 0),
        lastPreDueRemindedAt: asString(row.last_pre_due_reminded_at),
        lastManagerOverdueNotifiedAt: asString(row.last_manager_overdue_notified_at),
      };
    },

    tryClaimPreDueReminder(input: {
      subtaskId: string;
      nowIso: string;
      todayStartIso: string;
      sourceId: string;
    }): { claimed: boolean; reason?: string } {
      const changes = db
        .prepare(
          `INSERT INTO subtask_reminder_state(
             subtask_id, overdue_since, last_pre_due_reminded_at
           ) VALUES(?, ?, ?)
           ON CONFLICT(subtask_id) DO UPDATE SET
             last_pre_due_reminded_at = excluded.last_pre_due_reminded_at
           WHERE subtask_reminder_state.last_pre_due_reminded_at IS NULL
              OR subtask_reminder_state.last_pre_due_reminded_at < ?`,
        )
        .run(
          input.subtaskId,
          input.nowIso,
          input.nowIso,
          input.todayStartIso,
        ).changes;
      return changes === 1 ? { claimed: true } : { claimed: false, reason: "already_sent_today" };
    },

    tryClaimManagerOverdueAlert(input: {
      subtaskId: string;
      overdueSince: string;
      nowIso: string;
      sourceId: string;
    }): { claimed: boolean; reason?: string } {
      const changes = db
        .prepare(
          `INSERT INTO subtask_reminder_state(
             subtask_id, overdue_since, last_manager_overdue_notified_at
           ) VALUES(?, ?, ?)
           ON CONFLICT(subtask_id) DO UPDATE SET
             overdue_since = excluded.overdue_since,
             last_manager_overdue_notified_at = excluded.last_manager_overdue_notified_at
           WHERE subtask_reminder_state.last_manager_overdue_notified_at IS NULL
              OR subtask_reminder_state.overdue_since <> excluded.overdue_since`,
        )
        .run(input.subtaskId, input.overdueSince, input.nowIso).changes;
      return changes === 1
        ? { claimed: true }
        : { claimed: false, reason: "already_notified_this_episode" };
    },

    tryClaimSchedulerReminder(input: {
      subtaskId: string;
      overdueSince: string;
      nowIso: string;
      tier: string;
      todayStartIso: string;
      schedulerSourceId: string;
    }): { claimed: boolean; reason?: string } {
      const changes = db
        .prepare(
          `INSERT INTO subtask_reminder_state(
             subtask_id, overdue_since, last_reminded_at, remind_count, last_tier, last_scheduler_source_id
           ) VALUES(?, ?, ?, 1, ?, ?)
           ON CONFLICT(subtask_id) DO UPDATE SET
             last_reminded_at = excluded.last_reminded_at,
             remind_count = subtask_reminder_state.remind_count + 1,
             last_tier = excluded.last_tier,
             last_scheduler_source_id = excluded.last_scheduler_source_id
           WHERE subtask_reminder_state.last_reminded_at IS NULL
              OR subtask_reminder_state.last_reminded_at < ?`,
        )
        .run(
          input.subtaskId,
          input.overdueSince,
          input.nowIso,
          input.tier,
          input.schedulerSourceId,
          input.todayStartIso,
        ).changes;
      return changes === 1 ? { claimed: true } : { claimed: false, reason: "already_sent_today" };
    },

    recordManualReminder(input: {
      subtaskId: string;
      overdueSince: string;
      nowIso: string;
      manualSourceId: string;
    }): void {
      db.prepare(
        `INSERT INTO subtask_reminder_state(
           subtask_id, overdue_since, last_manual_reminded_at, manual_remind_count, last_manual_source_id
         ) VALUES(?, ?, ?, 1, ?)
         ON CONFLICT(subtask_id) DO UPDATE SET
           overdue_since = COALESCE(subtask_reminder_state.overdue_since, excluded.overdue_since),
           last_manual_reminded_at = excluded.last_manual_reminded_at,
           manual_remind_count = subtask_reminder_state.manual_remind_count + 1,
           last_manual_source_id = excluded.last_manual_source_id`,
      ).run(input.subtaskId, input.overdueSince, input.nowIso, input.manualSourceId);
    },

    listProgressDigestManagerUserIds(): string[] {
      const rows = db
        .prepare(
          "SELECT DISTINCT manager_user_id AS uid FROM tasks WHERE TRIM(manager_user_id) <> ''",
        )
        .all() as Array<{ uid?: string }>;
      return rows.map((r) => String(r.uid ?? "").trim()).filter(Boolean);
    },

    listProgressDigestEmployeeUserIds(): string[] {
      const rows = db
        .prepare(
          "SELECT DISTINCT assignee_user_id AS uid FROM subtasks WHERE TRIM(assignee_user_id) <> ''",
        )
        .all() as Array<{ uid?: string }>;
      return rows.map((r) => String(r.uid ?? "").trim()).filter(Boolean);
    },

    hasActiveTasksAsManager(managerUserId: string): boolean {
      const row = db
        .prepare(
          `SELECT 1 AS ok FROM tasks t
             JOIN subtasks s ON s.task_id = t.task_id
            WHERE t.manager_user_id = ? AND s.status NOT IN ('DONE','STOPPED')
            LIMIT 1`,
        )
        .get(managerUserId) as { ok?: number } | undefined;
      return Boolean(row?.ok);
    },

    hasActiveSubtasksAsEmployee(assigneeUserId: string): boolean {
      const row = db
        .prepare(
          "SELECT 1 AS ok FROM subtasks WHERE assignee_user_id = ? AND status NOT IN ('DONE','STOPPED') LIMIT 1",
        )
        .get(assigneeUserId) as { ok?: number } | undefined;
      return Boolean(row?.ok);
    },

    listTaskEventsForManagerSince(input: {
      managerUserId: string;
      sinceIso: string;
      untilIso?: string;
      eventTypes?: string[];
      limit?: number;
      offset?: number;
    }): Array<Record<string, unknown>> {
      const types = (input.eventTypes ?? []).filter(Boolean);
      const typeClause = types.length > 0 ? ` AND e.event_type IN (${types.map(() => "?").join(", ")})` : "";
      const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
      const offset = Math.max(0, Math.floor(input.offset ?? 0));
      const untilIso = String(input.untilIso ?? "").trim();
      const untilClause = untilIso ? " AND e.occurred_at < ?" : "";
      const params: Array<string | number | null> = [input.managerUserId, input.sinceIso];
      if (untilIso) params.push(untilIso);
      params.push(...types, limit, offset);
      return db
        .prepare(
          `SELECT e.*, t.task_no, t.title AS task_title, s.title AS subtask_title
             FROM task_events e
             JOIN tasks t ON t.task_id = e.task_id
             LEFT JOIN subtasks s ON s.subtask_id = e.subtask_id
            WHERE t.manager_user_id = ?
              AND e.occurred_at >= ?${untilClause}
              ${typeClause}
            ORDER BY e.occurred_at DESC, e.id DESC
            LIMIT ? OFFSET ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
    },

    countTaskEventsForManagerInRange(input: {
      managerUserId: string;
      sinceIso: string;
      untilIso?: string;
      eventTypes?: string[];
    }): { count: number } {
      const types = (input.eventTypes ?? []).filter(Boolean);
      const typeClause = types.length > 0 ? ` AND e.event_type IN (${types.map(() => "?").join(", ")})` : "";
      const untilIso = String(input.untilIso ?? "").trim();
      const untilClause = untilIso ? " AND e.occurred_at < ?" : "";
      const params: Array<string | number | null> = [input.managerUserId, input.sinceIso];
      if (untilIso) params.push(untilIso);
      params.push(...types);
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count
             FROM task_events e
             JOIN tasks t ON t.task_id = e.task_id
            WHERE t.manager_user_id = ?
              AND e.occurred_at >= ?${untilClause}
              ${typeClause}`,
        )
        .get(...params) as { count?: number } | undefined;
      return { count: Number(row?.count ?? 0) };
    },

    listTaskEventsForEmployeeSince(input: {
      assigneeUserId: string;
      sinceIso: string;
      untilIso?: string;
      eventTypes: string[];
      limit?: number;
    }): Array<Record<string, unknown>> {
      const types = input.eventTypes.filter(Boolean);
      if (types.length === 0) return [];
      const placeholders = types.map(() => "?").join(", ");
      const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
      const untilIso = String(input.untilIso ?? "").trim();
      const untilClause = untilIso ? " AND e.occurred_at < ?" : "";
      const params: Array<string | number | null> = [input.assigneeUserId, input.sinceIso];
      if (untilIso) params.push(untilIso);
      params.push(...types, limit);
      return db
        .prepare(
          `SELECT e.*, t.task_no, t.title AS task_title, s.title AS subtask_title
             FROM task_events e
             JOIN tasks t ON t.task_id = e.task_id
             JOIN subtasks s ON s.subtask_id = e.subtask_id
            WHERE s.assignee_user_id = ?
              AND e.occurred_at >= ?${untilClause}
              AND e.event_type IN (${placeholders})
            ORDER BY e.occurred_at DESC
            LIMIT ?`,
        )
        .all(...params) as Array<Record<string, unknown>>;
    },

    tryClaimProgressDigest(input: {
      userId: string;
      audience: string;
      nowIso: string;
      todayStartIso: string;
      sourceId: string;
    }): { claimed: boolean; reason?: string } {
      const changes = db
        .prepare(
          `INSERT INTO progress_digest_state(user_id, audience, last_sent_at, last_source_id)
           VALUES(?, ?, ?, ?)
           ON CONFLICT(user_id, audience) DO UPDATE SET
             last_sent_at = excluded.last_sent_at,
             last_source_id = excluded.last_source_id
           WHERE progress_digest_state.last_sent_at IS NULL
              OR progress_digest_state.last_sent_at < ?`,
        )
        .run(
          input.userId,
          input.audience,
          input.nowIso,
          input.sourceId,
          input.todayStartIso,
        ).changes;
      return changes === 1 ? { claimed: true } : { claimed: false, reason: "already_sent_today" };
    },
  };
}
