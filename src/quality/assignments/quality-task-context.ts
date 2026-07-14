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
  requiresEvidence: true;
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
    for (const row of rows) {
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
