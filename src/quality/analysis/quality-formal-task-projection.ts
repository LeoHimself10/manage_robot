import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

type DatabaseRow = Record<string, unknown>;

export type QualityEmployeeTaskStage = "ASSIGNED" | "ACTIVE" | "WAITING_MANAGER" | "DONE";
export type QualityEmployeeOpenSignal = "changes" | "rejected" | null;

export interface QualityFormalSubtaskProjection {
  eventId: string;
  eventNo: string;
  eventTitle: string;
  eventSummary: string;
  integrationKey: string;
  taskId: string;
  taskNo: string;
  taskTitle: string;
  subtaskId: string;
  subtaskTitle: string;
  objective: string;
  assigneeUserId: string;
  status: string;
  openDeclineKind: QualityEmployeeOpenSignal;
  dueAt: string | null;
  managerUserId: string;
}

export interface QualityPlanningTaskContext {
  source: "quality_planning_handoff";
  eventId: string;
  eventNo: string;
  eventTitle: string;
  eventSummary: string;
  integrationKey: string;
  taskId: string;
  taskNo: string;
  subtaskId: string;
  status: string;
  requiresEvidence: false;
  taskUrl: string;
}

function tableExists(db: DatabaseSync, tableName: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?",
  ).get(tableName));
}

function nullable(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function deterministicProjectionId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
  return `${prefix}:${digest}`;
}

function qualityNodeStatusForFormalSubtask(status: unknown): string {
  switch (String(status ?? "").trim().toUpperCase()) {
    case "IN_PROGRESS":
    case "BLOCKED":
      return "IN_PROGRESS";
    case "DONE":
      return "PENDING_PARENT_REVIEW";
    case "STOPPED":
      return "CANCELLED";
    case "REJECTED":
      return "REJECTED";
    default:
      return "PENDING_ACCEPTANCE";
  }
}

function projectionFromRow(row: DatabaseRow): QualityFormalSubtaskProjection {
  return {
    eventId: String(row.event_id),
    eventNo: String(row.event_no),
    eventTitle: String(row.event_title),
    eventSummary: String(row.event_summary ?? ""),
    integrationKey: String(row.integration_key),
    taskId: String(row.task_id),
    taskNo: String(row.task_no),
    taskTitle: String(row.task_title),
    subtaskId: String(row.subtask_id),
    subtaskTitle: String(row.subtask_title),
    objective: String(row.objective ?? ""),
    assigneeUserId: String(row.assignee_user_id),
    status: String(row.status),
    openDeclineKind: null,
    dueAt: nullable(row.due_at),
    managerUserId: String(row.manager_user_id),
  };
}

export function qualityEmployeeTaskStage(
  status: unknown,
  openDeclineKind?: QualityEmployeeOpenSignal,
): QualityEmployeeTaskStage {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (openDeclineKind === "changes" || openDeclineKind === "rejected") return "WAITING_MANAGER";
  if (normalized === "IN_PROGRESS" || normalized === "BLOCKED") return "ACTIVE";
  if (normalized === "REJECTED" || normalized === "CHANGES_REQUESTED") return "WAITING_MANAGER";
  if (normalized === "DONE" || normalized === "STOPPED") return "DONE";
  return "ASSIGNED";
}

export function qualityFormalTaskStatusLabel(
  status: unknown,
  openDeclineKind?: QualityEmployeeOpenSignal,
): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (openDeclineKind === "changes" || openDeclineKind === "rejected") return "待主管处理";
  if (normalized === "ASSIGNED") return "待承接";
  if (normalized === "CHANGES_REQUESTED") return "待调整";
  if (normalized === "IN_PROGRESS") return "执行中";
  if (normalized === "BLOCKED") return "阻塞中";
  if (normalized === "REJECTED") return "待主管处理";
  if (normalized === "DONE") return "已完成";
  if (normalized === "STOPPED") return "已停止";
  return "状态待确认";
}

export function listQualityFormalSubtasks(input: {
  eventId: string;
  assigneeUserId?: string;
  dbPath?: string;
}): QualityFormalSubtaskProjection[] {
  const eventId = input.eventId.trim();
  const assigneeUserId = String(input.assigneeUserId ?? "").trim();
  const dbPath = input.dbPath ?? resolveWorkbenchSqlitePath();
  if (!eventId || !existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return listQualityFormalSubtasksFromDb(db, { eventId, assigneeUserId });
  } finally {
    db.close();
  }
}

export function listQualityFormalSubtasksFromDb(
  db: DatabaseSync,
  input: { eventId: string; assigneeUserId?: string },
): QualityFormalSubtaskProjection[] {
  const eventId = input.eventId.trim();
  const assigneeUserId = String(input.assigneeUserId ?? "").trim();
  if (!eventId) return [];
  if (!["quality_analysis_handoffs", "quality_events", "tasks", "subtasks"]
    .every((table) => tableExists(db, table))) return [];
  const rows = db.prepare(`
      SELECT h.integration_key,
             e.id AS event_id,e.event_no,e.title AS event_title,e.problem_status AS event_summary,
             t.task_id,t.task_no,t.title AS task_title,t.manager_user_id,
             s.subtask_id,s.title AS subtask_title,s.objective,s.assignee_user_id,s.status,s.due_at
      FROM quality_analysis_handoffs h
      JOIN quality_events e ON e.id=h.event_id AND e.deleted_at IS NULL
      JOIN tasks t ON t.plan_id=h.plan_id
      JOIN subtasks s ON s.task_id=t.task_id
      WHERE h.event_id=? AND (?='' OR s.assignee_user_id=?)
      ORDER BY s.created_at,s.subtask_id
    `).all(eventId, assigneeUserId, assigneeUserId) as DatabaseRow[];
  const projected = rows.map(projectionFromRow);
  const openSignals = readOpenDeclineKinds(db, projected.map((item) => item.subtaskId));
  return projected.map((item) => ({
    ...item,
    openDeclineKind: openSignals.get(item.subtaskId) ?? null,
  }));
}

function readOpenDeclineKinds(
  db: DatabaseSync,
  subtaskIds: string[],
): Map<string, QualityEmployeeOpenSignal> {
  const ids = [...new Set(subtaskIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, QualityEmployeeOpenSignal>();
  if (ids.length === 0 || !tableExists(db, "task_events")) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT subtask_id,event_type FROM task_events
    WHERE subtask_id IN (${placeholders}) ORDER BY id`).all(...ids) as DatabaseRow[];
  for (const row of rows) {
    const subtaskId = String(row.subtask_id);
    const eventType = String(row.event_type);
    const open = result.get(subtaskId) ?? null;
    if (eventType === "SUBTASK_CHANGES_REQUESTED" || eventType === "SUBTASK_CUSTOMIZE_NOTE") {
      result.set(subtaskId, "changes");
    } else if (eventType === "SUBTASK_REJECTED") {
      result.set(subtaskId, "rejected");
    } else if (eventType === "MANAGER_DECLINE_CHANGES" || eventType === "MANAGER_REASSIGN") {
      result.delete(subtaskId);
    } else if (open && eventType === "SUBTASK_ACCEPTED") {
      result.delete(subtaskId);
    }
  }
  return result;
}

export function getQualityPlanningContextsBySubtaskIds(
  subtaskIds: string[],
  viewerUserId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): Map<string, QualityPlanningTaskContext> {
  const ids = [...new Set(subtaskIds.map((id) => id.trim()).filter(Boolean))];
  const viewer = viewerUserId.trim();
  const result = new Map<string, QualityPlanningTaskContext>();
  if (ids.length === 0 || !viewer || !existsSync(dbPath)) return result;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!["quality_analysis_handoffs", "quality_events", "tasks", "subtasks"]
      .every((table) => tableExists(db, table))) return result;
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT h.integration_key,
             e.id AS event_id,e.event_no,e.title AS event_title,e.problem_status AS event_summary,
             t.task_id,t.task_no,
             s.subtask_id,s.status
      FROM quality_analysis_handoffs h
      JOIN quality_events e ON e.id=h.event_id AND e.deleted_at IS NULL
      JOIN tasks t ON t.plan_id=h.plan_id
      JOIN subtasks s ON s.task_id=t.task_id
      WHERE s.subtask_id IN (${placeholders}) AND s.assignee_user_id=?
    `).all(...ids, viewer) as DatabaseRow[];
    const openSignals = readOpenDeclineKinds(db, rows.map((row) => String(row.subtask_id)));
    for (const row of rows) {
      const taskNo = String(row.task_no);
      const status = String(row.status);
      const openDeclineKind = openSignals.get(String(row.subtask_id)) ?? null;
      const stage = qualityEmployeeTaskStage(status, openDeclineKind);
      const fromView = stage === "ASSIGNED" || stage === "WAITING_MANAGER" ? "new"
        : stage === "DONE" ? "history" : "current";
      result.set(String(row.subtask_id), {
        source: "quality_planning_handoff",
        eventId: String(row.event_id),
        eventNo: String(row.event_no),
        eventTitle: String(row.event_title),
        eventSummary: String(row.event_summary ?? ""),
        integrationKey: String(row.integration_key),
        taskId: String(row.task_id),
        taskNo,
        subtaskId: String(row.subtask_id),
        status,
        requiresEvidence: false,
        taskUrl: `/workbench/employee/task?taskNo=${encodeURIComponent(taskNo)}&fromView=${fromView}`,
      });
    }
    return result;
  } catch {
    return result;
  } finally {
    db.close();
  }
}

export function reconcileQualityPlanningPublication(input: {
  eventId: string;
  integrationKey: string;
  planId: string;
  formalTaskId: string;
  actorUserId: string;
  publishedAt?: string;
  dbPath?: string;
}): { matched: boolean; eventStatusChanged: boolean } {
  const eventId = input.eventId.trim();
  const integrationKey = input.integrationKey.trim();
  const planId = input.planId.trim();
  const formalTaskId = input.formalTaskId.trim();
  const actorUserId = input.actorUserId.trim();
  const dbPath = input.dbPath ?? resolveWorkbenchSqlitePath();
  if (!eventId || !integrationKey || !planId || !formalTaskId || !actorUserId || !existsSync(dbPath)) {
    return { matched: false, eventStatusChanged: false };
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=8000");
  try {
    if (!["quality_analysis_handoffs", "quality_events", "quality_audit_events", "tasks", "subtasks",
      "quality_assignment_nodes", "quality_task_links"]
      .every((table) => tableExists(db, table))) {
      return { matched: false, eventStatusChanged: false };
    }
    const handoff = db.prepare(`
      SELECT handoff_id,status,formal_task_id,primary_department_name,primary_manager_user_id
      FROM quality_analysis_handoffs
      WHERE event_id=? AND integration_key=? AND plan_id=?
    `).get(eventId, integrationKey, planId) as DatabaseRow | undefined;
    if (!handoff) return { matched: false, eventStatusChanged: false };
    const event = db.prepare(`SELECT id,status,primary_node_id,overall_due_at,title
      FROM quality_events WHERE id=? AND deleted_at IS NULL`).get(eventId) as DatabaseRow | undefined;
    if (!event) return { matched: false, eventStatusChanged: false };
    const task = db.prepare(`SELECT task_id,task_no,title,manager_user_id,published_at
      FROM tasks WHERE task_id=? AND plan_id=?`)
      .get(formalTaskId, planId) as DatabaseRow | undefined;
    if (!task) return { matched: false, eventStatusChanged: false };
    const subtasks = db.prepare(`SELECT subtask_id,source_task_key,title,objective,assignee_user_id,status,due_at,created_at
      FROM subtasks WHERE task_id=? ORDER BY created_at,subtask_id`).all(formalTaskId) as DatabaseRow[];
    if (subtasks.length === 0) return { matched: false, eventStatusChanged: false };
    const publishedAt = String(input.publishedAt ?? task.published_at ?? new Date().toISOString());
    const auditRequestId = `quality-planning-published:${integrationKey}`;
    const rootNodeId = deterministicProjectionId("quality-root", eventId, formalTaskId);
    const existingPrimaryNodeId = nullable(event.primary_node_id);
    if (existingPrimaryNodeId && existingPrimaryNodeId !== rootNodeId) {
      throw new Error("quality event already has a different primary node");
    }
    const dueCandidates = subtasks.map((row) => nullable(row.due_at)).filter((value): value is string => Boolean(value));
    const rootDueAt = nullable(event.overall_due_at)
      ?? dueCandidates.sort((a, b) => b.localeCompare(a))[0]
      ?? publishedAt;
    const managerUserId = String(task.manager_user_id ?? handoff.primary_manager_user_id).trim();
    if (!managerUserId) throw new Error("formal task manager is missing");
    const departmentName = String(handoff.primary_department_name ?? "").trim() || "待确认部门";
    let eventStatusChanged = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existingRoot = db.prepare(`SELECT event_id,parent_node_id,assignee_user_id,is_primary
        FROM quality_assignment_nodes WHERE node_id=?`).get(rootNodeId) as DatabaseRow | undefined;
      if (existingRoot) {
        if (String(existingRoot.event_id) !== eventId
          || existingRoot.parent_node_id != null
          || String(existingRoot.assignee_user_id) !== managerUserId
          || Number(existingRoot.is_primary) !== 1) {
          throw new Error("quality primary projection conflict");
        }
      } else {
        db.prepare(`INSERT INTO quality_assignment_nodes(
          node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,
          is_primary,status,due_at,requirement,version,created_by,request_id,accepted_at,
          submitted_at,created_at,updated_at
        ) VALUES(?,?,NULL,0,?,'MANAGER',?,1,'IN_PROGRESS',?,?,1,?,?,?,NULL,?,?)`).run(
          rootNodeId,
          eventId,
          managerUserId,
          departmentName,
          rootDueAt,
          `汇总并验收质量事件“${String(event.title)}”的正式任务执行结果`,
          actorUserId,
          `quality-planning-root:${integrationKey}`,
          publishedAt,
          publishedAt,
          publishedAt,
        );
      }
      for (const subtask of subtasks) {
        const subtaskId = String(subtask.subtask_id);
        const childNodeId = deterministicProjectionId("quality-node", eventId, subtaskId);
        const assigneeUserId = String(subtask.assignee_user_id ?? "").trim();
        if (!assigneeUserId) throw new Error(`formal subtask assignee is missing: ${subtaskId}`);
        const childStatus = qualityNodeStatusForFormalSubtask(subtask.status);
        const existingChild = db.prepare(`SELECT event_id,parent_node_id,assignee_user_id
          FROM quality_assignment_nodes WHERE node_id=?`).get(childNodeId) as DatabaseRow | undefined;
        if (existingChild) {
          if (String(existingChild.event_id) !== eventId
            || String(existingChild.parent_node_id ?? "") !== rootNodeId
            || String(existingChild.assignee_user_id) !== assigneeUserId) {
            throw new Error(`quality subtask projection conflict: ${subtaskId}`);
          }
        } else {
          db.prepare(`INSERT INTO quality_assignment_nodes(
            node_id,event_id,parent_node_id,depth,assignee_user_id,assignee_kind,department_name,
            is_primary,status,due_at,requirement,version,created_by,request_id,accepted_at,
            submitted_at,created_at,updated_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            childNodeId,
            eventId,
            rootNodeId,
            1,
            assigneeUserId,
            assigneeUserId === managerUserId ? "MANAGER" : "EMPLOYEE",
            departmentName,
            0,
            childStatus,
            nullable(subtask.due_at) ?? rootDueAt,
            nullable(subtask.objective) ?? String(subtask.title),
            1,
            actorUserId,
            `quality-planning-subtask:${subtaskId}`,
            childStatus === "IN_PROGRESS" || childStatus === "PENDING_PARENT_REVIEW" ? publishedAt : null,
            childStatus === "PENDING_PARENT_REVIEW" ? publishedAt : null,
            publishedAt,
            publishedAt,
          );
        }
        const linkIntegrationKey = `quality-node:${childNodeId}`;
        const existingLink = db.prepare(`SELECT node_id,task_id,integration_key
          FROM quality_task_links WHERE subtask_id=?`).get(subtaskId) as DatabaseRow | undefined;
        if (existingLink) {
          if (String(existingLink.node_id) !== childNodeId
            || String(existingLink.task_id) !== formalTaskId
            || String(existingLink.integration_key) !== linkIntegrationKey) {
            throw new Error(`quality task link conflict: ${subtaskId}`);
          }
        } else {
          db.prepare(`INSERT INTO quality_task_links(node_id,task_id,subtask_id,integration_key,created_at)
            VALUES(?,?,?,?,?)`).run(childNodeId, formalTaskId, subtaskId, linkIntegrationKey, publishedAt);
        }
      }
      db.prepare(`UPDATE quality_analysis_handoffs
        SET status='PUBLISHED',formal_task_id=?,published_at=COALESCE(published_at,?)
        WHERE handoff_id=?`).run(formalTaskId, publishedAt, String(handoff.handoff_id));
      const updated = db.prepare(`UPDATE quality_events
        SET status=CASE WHEN status='PENDING_ASSIGNMENT' THEN 'PENDING_ACCEPTANCE' ELSE status END,
            primary_node_id=COALESCE(primary_node_id,?),version=version+1,updated_at=?
        WHERE id=? AND (status='PENDING_ASSIGNMENT' OR primary_node_id IS NULL)`).run(
        rootNodeId,
        publishedAt,
        eventId,
      );
      eventStatusChanged = String(event.status) === "PENDING_ASSIGNMENT" && Number(updated.changes) === 1;
      const audited = db.prepare(`SELECT 1 AS ok FROM quality_audit_events
        WHERE event_id=? AND request_id=? LIMIT 1`).get(eventId, auditRequestId);
      if (!audited) {
        db.prepare(`INSERT INTO quality_audit_events(
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
        ) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
          randomUUID(),
          eventId,
          actorUserId,
          "department_manager",
          "QUALITY_FORMAL_TASK_PUBLISHED",
          JSON.stringify({ handoffStatus: String(handoff.status) }),
          JSON.stringify({
            formalTaskId,
            planId,
            handoffStatus: "PUBLISHED",
            rootNodeId,
            linkedSubtaskCount: subtasks.length,
          }),
          "正式任务已通过原任务系统发放；质量模块建立证据与验收关联，执行状态仍以正式子任务为准",
          auditRequestId,
          publishedAt,
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no-op */ }
      throw error;
    }
    return { matched: true, eventStatusChanged };
  } finally {
    db.close();
  }
}
