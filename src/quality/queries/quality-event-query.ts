import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import type { QualityEventRecord } from "../domain/quality-types";

type DatabaseRow = Record<string, unknown>;

export interface QualityEventDetailView {
  event: QualityEventRecord;
  sourceSnapshots: Array<Record<string, unknown>>;
  relatedEvents: Array<Record<string, unknown>>;
  assignmentTree: Array<Record<string, unknown> & { nodeId: string; parentNodeId: string | null }>;
  evidence: Array<Record<string, unknown>>;
  reviews: Array<Record<string, unknown>>;
  publicAudit: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  reportingSnapshots: Record<string, unknown> | null;
  allowedActions: string[];
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function eventFromRow(row: DatabaseRow): QualityEventRecord {
  return {
    eventId: String(row.id), eventNo: String(row.event_no), status: String(row.status) as QualityEventRecord["status"],
    title: String(row.title), problemStatus: String(row.problem_status), occurredAt: nullable(row.occurred_at),
    feedbackAt: nullable(row.feedback_at), feedbackUserId: nullable(row.feedback_user_id), feedbackName: nullable(row.feedback_name),
    deviceModel: nullable(row.device_model), deviceSerial: nullable(row.device_serial), catheterBatch: nullable(row.catheter_batch),
    clinicianAware: nullable(row.clinician_aware), impact: nullable(row.impact), initialCategory: nullable(row.initial_category),
    urgency: nullable(row.urgency) as QualityEventRecord["urgency"], supplement: nullable(row.supplement),
    createdBy: String(row.created_by), submittedBy: nullable(row.submitted_by), submittedAt: nullable(row.submitted_at),
    originalPrimaryDepartmentId: nullable(row.original_primary_department_id), overallDueAt: nullable(row.overall_due_at),
    primaryNodeId: nullable(row.primary_node_id), version: Number(row.version), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), deletedAt: nullable(row.deleted_at),
  };
}

const AUDIT_TEXT_KEYS = new Set([
  "status", "title", "problemStatus", "currentSituation", "supplement", "content", "kind", "reason", "conclusion",
  "nodeId", "returnedNodeId", "affectedNodeIds", "dueAt", "overallDueAt", "requirement", "departmentName",
  "assigneeUserId", "primaryManagerUserId", "decision", "evidenceVersion", "sourceKey",
]);

function safeAuditObject(raw: unknown): Record<string, unknown> | null {
  const source = parseObject(raw);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!AUDIT_TEXT_KEYS.has(key)) continue;
    if (Array.isArray(value)) safe[key] = value.map((item) => String(item)).slice(0, 100);
    else if (value == null || typeof value === "number" || typeof value === "boolean") safe[key] = value;
    else safe[key] = String(value).slice(0, 10_000);
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}

export interface QualityEventListItem extends QualityEventRecord {
  planningHandoff?: {
    analysisVersion: number;
    status: string;
    primaryDepartmentName: string;
    planningUrl: string;
  };
}

/**
 * Read-only capability probe used by the shared workbench shell. It never
 * changes the manager's base role; it only exposes the additive quality entry
 * after a formal analysis handoff has actually been addressed to that manager.
 */
export function hasQualityPlanningHandoff(
  managerUserId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): boolean {
  const userId = String(managerUserId ?? "").trim();
  if (!userId) return false;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    if (!tableExists(db, "quality_analysis_handoffs")) return false;
    return Boolean(db.prepare(`SELECT 1 AS ok FROM quality_analysis_handoffs
      WHERE primary_manager_user_id=? LIMIT 1`).get(userId));
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function safeText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).slice(0, 10_000);
  return /(client[_-]?secret|access[_-]?token|password|private[_-]?key)/i.test(text) ? "[敏感内容已隐藏]" : text;
}

function auditTouchesVisibleBranch(item: DatabaseRow, viewerUserId: string, visible: Set<string>): boolean {
  if (String(item.actor_user_id) === viewerUserId) return true;
  for (const raw of [item.before_json, item.after_json]) {
    const value = parseObject(raw);
    for (const key of ["nodeId", "returnedNodeId"]) if (value[key] != null && visible.has(String(value[key]))) return true;
    for (const key of ["affectedNodeIds"]) if (Array.isArray(value[key]) && value[key].some((nodeId) => visible.has(String(nodeId)))) return true;
  }
  return false;
}

function allowedActions(input: {
  event: QualityEventRecord;
  viewerUserId: string;
  isSpecialist: boolean;
  isAftersalesOwner: boolean;
  visibleNodes: DatabaseRow[];
}): string[] {
  const actions: string[] = [];
  if (input.isSpecialist) {
    if (input.event.status === "PENDING_ASSIGNMENT") actions.push("分配原主责");
    if (!["DRAFT", "CLOSED"].includes(input.event.status) && input.event.primaryNodeId) actions.push("调整总期限");
    if (input.event.status === "PENDING_QUALITY_REVIEW") actions.push("指定节点退回", "关闭质量事件");
    if (input.event.status === "CLOSED") actions.push("重开质量事件");
  }
  if (input.isAftersalesOwner && input.event.status !== "CLOSED") actions.push("补充情况", "更正信息");
  for (const node of input.visibleNodes.filter((item) => String(item.assignee_user_id) === input.viewerUserId)) {
    const status = String(node.status);
    if (status === "PENDING_ACCEPTANCE") actions.push("承接任务", "驳回任务");
    if (["IN_PROGRESS", "RETURNED"].includes(status)) {
      actions.push("上传证据", "提交完成");
      if (String(node.assignee_kind) === "MANAGER") actions.push("继续分配", "调整下级期限");
    }
    if (status === "PENDING_PARENT_REVIEW" && Number(node.is_primary) === 1) actions.push("原主责验收");
  }
  return [...new Set(actions)];
}

export function createQualityEventQuery(dbPath = resolveWorkbenchSqlitePath()) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");

  function loadEvent(eventId: string): DatabaseRow | undefined {
    return db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL").get(eventId) as DatabaseRow | undefined;
  }

  function visibleNodeIds(allNodes: DatabaseRow[], event: QualityEventRecord, viewerUserId: string, full: boolean): Set<string> {
    if (full) return new Set(allNodes.map((node) => String(node.node_id)));
    const children = new Map<string, string[]>();
    for (const node of allNodes) {
      const parent = nullable(node.parent_node_id);
      if (!parent) continue;
      const bucket = children.get(parent) ?? [];
      bucket.push(String(node.node_id));
      children.set(parent, bucket);
    }
    const visible = new Set<string>();
    const include = (nodeId: string) => {
      if (visible.has(nodeId)) return;
      visible.add(nodeId);
      for (const child of children.get(nodeId) ?? []) include(child);
    };
    for (const node of allNodes) {
      if (String(node.assignee_user_id) !== viewerUserId) continue;
      if (String(node.assignee_kind) === "MANAGER") include(String(node.node_id));
      else visible.add(String(node.node_id));
    }
    if (!event.primaryNodeId) return visible;
    return visible;
  }

  function orderVisibleNodes(allNodes: DatabaseRow[], visible: Set<string>): DatabaseRow[] {
    const byId = new Map(allNodes.map((node) => [String(node.node_id), node]));
    const children = new Map<string | null, string[]>();
    for (const node of allNodes) {
      const parent = nullable(node.parent_node_id);
      const bucket = children.get(parent) ?? [];
      bucket.push(String(node.node_id));
      children.set(parent, bucket);
    }
    for (const ids of children.values()) ids.sort((a, b) => String(byId.get(a)?.created_at).localeCompare(String(byId.get(b)?.created_at)) || a.localeCompare(b));
    const result: DatabaseRow[] = [];
    const walk = (nodeId: string) => {
      if (visible.has(nodeId)) result.push(byId.get(nodeId)!);
      for (const child of children.get(nodeId) ?? []) walk(child);
    };
    const roots = allNodes.filter((node) => {
      const id = String(node.node_id);
      const parent = nullable(node.parent_node_id);
      return visible.has(id) && (!parent || !visible.has(parent));
    });
    for (const root of roots) walk(String(root.node_id));
    return result;
  }

  function getEventDetail(input: { eventId: string; viewerUserId: string }): QualityEventDetailView | null {
    const row = loadEvent(input.eventId);
    if (!row) return null;
    const event = eventFromRow(row);
    const caps = resolveQualityCapabilities(input.viewerUserId);
    if (event.status === "DRAFT") {
      if (event.createdBy !== input.viewerUserId) return null;
      return {
        event, sourceSnapshots: [], relatedEvents: [], assignmentTree: [], evidence: [], reviews: [], publicAudit: [], notifications: [],
        reportingSnapshots: null,
        allowedActions: ["编辑草稿", "提交通报"],
      };
    }
    const allNodes = (tableExists(db, "tasks")
      ? db.prepare(`
          SELECT n.*,l.task_id,l.subtask_id,t.task_no
          FROM quality_assignment_nodes n
          LEFT JOIN quality_task_links l ON l.node_id=n.node_id
          LEFT JOIN tasks t ON t.task_id=l.task_id
          WHERE n.event_id=? AND n.status <> 'CANCELLED'
          ORDER BY n.depth,n.created_at,n.node_id
        `).all(event.eventId)
      : db.prepare(`
          SELECT n.*,l.task_id,l.subtask_id,NULL AS task_no
          FROM quality_assignment_nodes n
          LEFT JOIN quality_task_links l ON l.node_id=n.node_id
          WHERE n.event_id=? AND n.status <> 'CANCELLED'
          ORDER BY n.depth,n.created_at,n.node_id
        `).all(event.eventId)) as DatabaseRow[];
    const primary = allNodes.find((node) => Number(node.is_primary) === 1 || String(node.node_id) === event.primaryNodeId);
    const isSpecialist = caps.canAnalyzeQuality;
    const isAdmin = caps.baseRole === "admin";
    const isAftersalesOwner = caps.roles.includes("aftersales_manager") && event.createdBy === input.viewerUserId;
    const isPrimary = String(primary?.assignee_user_id ?? "") === input.viewerUserId;
    const isPlanningManager = tableExists(db, "quality_analysis_handoffs")
      && Boolean(db.prepare(`SELECT 1 AS ok FROM quality_analysis_handoffs
        WHERE event_id=? AND primary_manager_user_id=? LIMIT 1`)
        .get(event.eventId, input.viewerUserId));
    const full = isAdmin || isSpecialist || isAftersalesOwner || isPrimary || isPlanningManager;
    const visible = visibleNodeIds(allNodes, event, input.viewerUserId, full);
    if (!full && visible.size === 0) return null;
    const orderedNodes = orderVisibleNodes(allNodes, visible);
    const sourceSnapshots = (db.prepare(`SELECT * FROM quality_event_source_links WHERE event_id=? ORDER BY linked_at,id`).all(event.eventId) as DatabaseRow[])
      .map((item) => ({ sourceKey: String(item.source_key), sourceVersion: Number(item.source_version), sourceState: String(item.source_state_at_link), snapshot: parseObject(item.source_snapshot_json), linkedAt: String(item.linked_at) }));
    const relatedEvents = (db.prepare(`
      SELECT r.*,e.event_no AS related_event_no,e.title AS related_event_title,e.status AS related_event_status
      FROM quality_event_relations r LEFT JOIN quality_events e ON e.id=r.related_event_id
      WHERE r.event_id=? ORDER BY r.created_at,r.id
    `).all(event.eventId) as DatabaseRow[]).map((item) => ({
      relationId: String(item.id), relationType: String(item.relation_type), relatedEventId: nullable(item.related_event_id),
      relatedEventNo: nullable(item.related_event_no), relatedEventTitle: nullable(item.related_event_title), relatedEventStatus: nullable(item.related_event_status),
      relatedSourceKey: nullable(item.related_source_key), snapshot: parseObject(item.relation_snapshot_json), createdAt: String(item.created_at),
    }));
    const evidence = (db.prepare("SELECT * FROM quality_evidence WHERE event_id=? ORDER BY node_id,evidence_version,created_at,evidence_id").all(event.eventId) as DatabaseRow[])
      .filter((item) => visible.has(String(item.node_id))).map((item) => ({
        evidenceId: String(item.evidence_id), nodeId: String(item.node_id), evidenceVersion: Number(item.evidence_version),
        originalName: String(item.original_name), mimeType: String(item.mime_type), summary: String(item.summary ?? ""),
        sizeBytes: Number(item.size_bytes), sha256: String(item.sha256), uploadedBy: String(item.uploaded_by), createdAt: String(item.created_at),
      }));
    const reviews = (db.prepare("SELECT * FROM quality_node_reviews WHERE event_id=? ORDER BY created_at,review_id").all(event.eventId) as DatabaseRow[])
      .filter((item) => visible.has(String(item.node_id))).map((item) => ({
        reviewId: String(item.review_id), nodeId: String(item.node_id), reviewerUserId: String(item.reviewer_user_id), decision: String(item.decision),
        reason: nullable(item.reason), evidenceVersion: item.evidence_version == null ? null : Number(item.evidence_version), createdAt: String(item.created_at),
      }));
    const publicAudit = (db.prepare("SELECT actor_user_id,actor_role,action,before_json,after_json,reason,occurred_at FROM quality_audit_events WHERE event_id=? ORDER BY occurred_at,id").all(event.eventId) as DatabaseRow[])
      .filter((item) => full || auditTouchesVisibleBranch(item, input.viewerUserId, visible))
      .map((item) => ({
        actorUserId: String(item.actor_user_id), actorRole: String(item.actor_role), action: String(item.action),
        before: safeAuditObject(item.before_json), after: safeAuditObject(item.after_json),
        reason: safeText(item.reason), occurredAt: String(item.occurred_at),
      }));
    const notifications = tableExists(db, "quality_notification_outbox")
      ? (db.prepare(`SELECT notification_id AS id,action AS event_type,recipient_user_id,status,attempt_count AS attempts,last_error,created_at,updated_at FROM quality_notification_outbox WHERE event_id=? ORDER BY created_at,notification_id`).all(event.eventId) as DatabaseRow[])
          .filter((item) => isSpecialist || isAftersalesOwner || String(item.recipient_user_id) === input.viewerUserId)
          .map((item) => {
            const own = String(item.recipient_user_id) === input.viewerUserId;
            return { id: String(item.id), eventType: String(item.event_type), recipientUserId: isSpecialist || own ? String(item.recipient_user_id) : "相关人员", status: String(item.status), attempts: Number(item.attempts), lastError: isSpecialist ? safeText(item.last_error) : null, canRetry: isSpecialist && String(item.status) === "DEAD", createdAt: String(item.created_at), updatedAt: String(item.updated_at) };
          })
      : [];
    const reportingRow = db.prepare(`
      SELECT * FROM quality_event_reporting_snapshots WHERE event_id = ?
    `).get(event.eventId) as DatabaseRow | undefined;
    const reportingSnapshots = reportingRow ? {
      sourceSnapshots: JSON.parse(String(reportingRow.source_snapshots_json ?? "[]")) as unknown,
      aiAssessments: JSON.parse(String(reportingRow.ai_assessments_json ?? "[]")) as unknown,
      managerAssessments: JSON.parse(String(reportingRow.manager_assessments_json ?? "[]")) as unknown,
      frozenBy: String(reportingRow.frozen_by),
      frozenAt: String(reportingRow.frozen_at),
    } : null;
    return {
      event, sourceSnapshots, relatedEvents,
      assignmentTree: orderedNodes.map((item) => ({
        nodeId: String(item.node_id), parentNodeId: nullable(item.parent_node_id), depth: Number(item.depth), assigneeUserId: String(item.assignee_user_id),
        assigneeKind: String(item.assignee_kind), departmentName: String(item.department_name), isPrimary: Number(item.is_primary) === 1,
        status: String(item.status), dueAt: String(item.due_at), requirement: String(item.requirement), version: Number(item.version),
        taskId: nullable(item.task_id), subtaskId: nullable(item.subtask_id), taskNo: nullable(item.task_no), acceptedAt: nullable(item.accepted_at), submittedAt: nullable(item.submitted_at),
      })),
      evidence, reviews, publicAudit, notifications, reportingSnapshots,
      allowedActions: allowedActions({ event, viewerUserId: input.viewerUserId, isSpecialist, isAftersalesOwner, visibleNodes: orderedNodes }),
    };
  }

  function listEvents(input: { viewerUserId: string }): QualityEventListItem[] {
    const caps = resolveQualityCapabilities(input.viewerUserId);
    const isSpecialist = caps.canAnalyzeQuality ? 1 : 0;
    const isAdmin = caps.baseRole === "admin" ? 1 : 0;
    const isAftersales = caps.roles.includes("aftersales_manager") ? 1 : 0;
    const hasHandoffs = tableExists(db, "quality_analysis_handoffs");
    const handoffJoin = hasHandoffs
      ? `LEFT JOIN quality_analysis_handoffs h
          ON h.handoff_id=(
            SELECT h2.handoff_id FROM quality_analysis_handoffs h2
            WHERE h2.event_id=e.id AND h2.primary_manager_user_id=?
            ORDER BY h2.analysis_version DESC LIMIT 1
          )`
      : `LEFT JOIN (SELECT NULL AS event_id,NULL AS handoff_id,NULL AS analysis_version,
          NULL AS status,NULL AS primary_department_name,NULL AS thread_id) h ON 1=0`;
    const handoffArg = hasHandoffs ? [input.viewerUserId] : [];
    const rows = db.prepare(`
      SELECT DISTINCT e.*,h.handoff_id AS planning_handoff_id,
        h.analysis_version AS planning_analysis_version,
        h.status AS planning_handoff_status,
        h.primary_department_name AS planning_department_name,
        h.thread_id AS planning_thread_id
      FROM quality_events e
      LEFT JOIN quality_assignment_nodes n
        ON n.event_id=e.id AND n.assignee_user_id=? AND n.status <> 'CANCELLED'
      ${handoffJoin}
      WHERE e.deleted_at IS NULL AND (
        (e.status='DRAFT' AND e.created_by=?) OR
        (e.status<>'DRAFT' AND (?=1 OR ?=1)) OR
        (e.status<>'DRAFT' AND ?=1 AND e.created_by=?) OR
        (e.status<>'DRAFT' AND n.node_id IS NOT NULL) OR
        (e.status<>'DRAFT' AND h.event_id IS NOT NULL)
      )
      ORDER BY e.updated_at DESC,e.id
    `).all(
      input.viewerUserId,
      ...handoffArg,
      input.viewerUserId,
      isSpecialist,
      isAdmin,
      isAftersales,
      input.viewerUserId,
    ) as DatabaseRow[];
    return rows.map((row) => {
      const event = eventFromRow(row) as QualityEventListItem;
      if (row.planning_handoff_id != null && row.planning_thread_id != null) {
        event.planningHandoff = {
          analysisVersion: Number(row.planning_analysis_version),
          status: String(row.planning_handoff_status),
          primaryDepartmentName: String(row.planning_department_name),
          planningUrl: `/workbench/manager/chat?thread=side&threadId=${encodeURIComponent(String(row.planning_thread_id))}&openDraftEditor=1`,
        };
      }
      return event;
    });
  }

  return { getEventDetail, listEvents, close: () => db.close() };
}
