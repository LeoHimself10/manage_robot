import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

type DatabaseRow = Record<string, unknown>;

export interface EmployeeQualityTaskContext {
  nodeId: string;
  eventId: string;
  nodeStatus: string;
  nodeVersion: number;
  eventNo: string;
  eventTitle: string;
  eventSummary: string;
  primaryAssigneeUserId: string | null;
  parentAssigneeUserId: string | null;
  reviewReason?: string;
  requiresEvidence: true;
}

export interface ManagerQualityReviewEvidence {
  evidenceId: string;
  evidenceVersion: number;
  originalName: string;
  summary: string;
  mimeType: string;
  uploadedBy: string;
  createdAt: string;
}

export interface ManagerQualityReviewContext {
  taskId: string;
  taskNo: string;
  nodeId: string;
  nodeStatus: string;
  nodeVersion: number;
  eventId: string;
  eventNo: string;
  eventTitle: string;
  eventStatus: string;
  eventVersion: number;
  isTest: boolean;
  primaryNodeId: string | null;
  primaryAssigneeUserId: string | null;
  parentAssigneeUserId: string | null;
  canReview: boolean;
  reviewDecision: "APPROVE" | "RETURN" | null;
  reviewReason: string;
  reviewedAt: string | null;
  evidence: ManagerQualityReviewEvidence[];
}

export function getQualityContextBySubtaskIds(
  subtaskIds: string[],
  viewerUserId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): Map<string, EmployeeQualityTaskContext> {
  const ids = [...new Set(subtaskIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, EmployeeQualityTaskContext>();
  if (ids.length === 0 || !viewerUserId.trim() || !existsSync(dbPath)) return result;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const table = db.prepare(`
      SELECT COUNT(*) AS total FROM sqlite_master
      WHERE type = 'table' AND name IN ('quality_task_links','quality_assignment_nodes','quality_events')
    `).get() as DatabaseRow;
    if (Number(table.total) !== 3) return result;
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT l.subtask_id, n.node_id, n.event_id, n.status AS node_status,
             n.version AS node_version, e.event_no, e.title AS event_title,
             e.problem_status AS event_summary,
             primary_node.assignee_user_id AS primary_assignee_user_id,
             parent.assignee_user_id AS parent_assignee_user_id
      FROM quality_task_links l
      JOIN quality_assignment_nodes n ON n.node_id = l.node_id
      JOIN quality_events e ON e.id = n.event_id AND e.deleted_at IS NULL
      LEFT JOIN quality_assignment_nodes primary_node ON primary_node.node_id = e.primary_node_id
      LEFT JOIN quality_assignment_nodes parent ON parent.node_id = n.parent_node_id
      WHERE l.subtask_id IN (${placeholders}) AND n.assignee_user_id = ?
    `).all(...ids, viewerUserId) as DatabaseRow[];
    const hasReviews = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_node_reviews'").get();
    for (const row of rows) {
      const review = hasReviews && String(row.node_status) === "RETURNED"
        ? db.prepare("SELECT reason FROM quality_node_reviews WHERE node_id=? AND decision='RETURN' ORDER BY created_at DESC,review_id DESC LIMIT 1").get(String(row.node_id)) as DatabaseRow | undefined
        : undefined;
      result.set(String(row.subtask_id), {
        nodeId: String(row.node_id),
        eventId: String(row.event_id),
        nodeStatus: String(row.node_status),
        nodeVersion: Number(row.node_version),
        eventNo: String(row.event_no),
        eventTitle: String(row.event_title),
        eventSummary: String(row.event_summary),
        primaryAssigneeUserId: row.primary_assignee_user_id == null ? null : String(row.primary_assignee_user_id),
        parentAssigneeUserId: row.parent_assignee_user_id == null ? null : String(row.parent_assignee_user_id),
        reviewReason: String(review?.reason ?? ""),
        requiresEvidence: true,
      });
    }
    return result;
  } catch {
    return result;
  } finally {
    db.close();
  }
}

/**
 * 原主管任务详情中的质量验收上下文。只返回当前主管直接管理、且通过
 * quality_task_links 关联的正式子任务；质量页仍不直接执行验收。
 */
export function getManagerQualityReviewContextsBySubtaskIds(
  subtaskIds: string[],
  managerUserId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): Map<string, ManagerQualityReviewContext> {
  const ids = [...new Set(subtaskIds.map((id) => id.trim()).filter(Boolean))];
  const manager = managerUserId.trim();
  const result = new Map<string, ManagerQualityReviewContext>();
  if (ids.length === 0 || !manager || !existsSync(dbPath)) return result;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const requiredTables = [
      "quality_task_links",
      "quality_assignment_nodes",
      "quality_events",
      "tasks",
      "subtasks",
      "quality_evidence",
      "quality_node_reviews",
    ];
    const found = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (${requiredTables.map(() => "?").join(",")})
    `).all(...requiredTables) as DatabaseRow[];
    if (new Set(found.map((row) => String(row.name))).size !== requiredTables.length) return result;
    const placeholders = ids.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT l.subtask_id,
             t.task_id,t.task_no,
             n.node_id,n.status AS node_status,n.version AS node_version,
             e.id AS event_id,e.event_no,e.title AS event_title,e.status AS event_status,
             e.version AS event_version,e.is_test,e.primary_node_id,
             primary_node.assignee_user_id AS primary_assignee_user_id,
             parent.assignee_user_id AS parent_assignee_user_id,
             s.status AS subtask_status
      FROM quality_task_links l
      JOIN quality_assignment_nodes n ON n.node_id=l.node_id
      JOIN quality_events e ON e.id=n.event_id AND e.deleted_at IS NULL
      JOIN tasks t ON t.task_id=l.task_id
      JOIN subtasks s ON s.subtask_id=l.subtask_id AND s.task_id=t.task_id
      LEFT JOIN quality_assignment_nodes primary_node ON primary_node.node_id=e.primary_node_id
      LEFT JOIN quality_assignment_nodes parent ON parent.node_id=n.parent_node_id
      WHERE l.subtask_id IN (${placeholders})
        AND t.manager_user_id=?
        AND parent.assignee_user_id=?
    `).all(...ids, manager, manager) as DatabaseRow[];
    if (rows.length === 0) return result;

    const nodeIds = rows.map((row) => String(row.node_id));
    const nodePlaceholders = nodeIds.map(() => "?").join(",");
    const evidenceRows = db.prepare(`
      SELECT evidence_id,node_id,evidence_version,original_name,summary,mime_type,
             uploaded_by,created_at
      FROM quality_evidence
      WHERE node_id IN (${nodePlaceholders}) AND removed_at IS NULL
      ORDER BY node_id,evidence_version,created_at,evidence_id
    `).all(...nodeIds) as DatabaseRow[];
    const reviewRows = db.prepare(`
      SELECT node_id,decision,reason,created_at
      FROM quality_node_reviews
      WHERE node_id IN (${nodePlaceholders})
      ORDER BY created_at,review_id
    `).all(...nodeIds) as DatabaseRow[];
    const evidenceByNode = new Map<string, ManagerQualityReviewEvidence[]>();
    for (const row of evidenceRows) {
      const nodeId = String(row.node_id);
      const list = evidenceByNode.get(nodeId) ?? [];
      list.push({
        evidenceId: String(row.evidence_id),
        evidenceVersion: Number(row.evidence_version),
        originalName: String(row.original_name ?? "质量证据"),
        summary: String(row.summary ?? ""),
        mimeType: String(row.mime_type ?? "application/octet-stream"),
        uploadedBy: String(row.uploaded_by ?? ""),
        createdAt: String(row.created_at ?? ""),
      });
      evidenceByNode.set(nodeId, list);
    }
    const latestReviewByNode = new Map<string, DatabaseRow>();
    for (const row of reviewRows) latestReviewByNode.set(String(row.node_id), row);

    for (const row of rows) {
      const nodeId = String(row.node_id);
      const latestReview = latestReviewByNode.get(nodeId);
      const decision = String(latestReview?.decision ?? "").trim().toUpperCase();
      result.set(String(row.subtask_id), {
        taskId: String(row.task_id),
        taskNo: String(row.task_no),
        nodeId,
        nodeStatus: String(row.node_status),
        nodeVersion: Number(row.node_version),
        eventId: String(row.event_id),
        eventNo: String(row.event_no),
        eventTitle: String(row.event_title),
        eventStatus: String(row.event_status),
        eventVersion: Number(row.event_version),
        isTest: Number(row.is_test ?? 0) === 1,
        primaryNodeId: row.primary_node_id == null ? null : String(row.primary_node_id),
        primaryAssigneeUserId: row.primary_assignee_user_id == null
          ? null
          : String(row.primary_assignee_user_id),
        parentAssigneeUserId: row.parent_assignee_user_id == null
          ? null
          : String(row.parent_assignee_user_id),
        canReview: String(row.node_status) === "PENDING_PARENT_REVIEW"
          && String(row.subtask_status).toUpperCase() === "DONE",
        reviewDecision: decision === "APPROVE" || decision === "RETURN" ? decision : null,
        reviewReason: String(latestReview?.reason ?? ""),
        reviewedAt: latestReview?.created_at == null ? null : String(latestReview.created_at),
        evidence: evidenceByNode.get(nodeId) ?? [],
      });
    }
    return result;
  } catch {
    return result;
  } finally {
    db.close();
  }
}
