import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import type { QualityEventRecord } from "../domain/quality-types";
import { createQualityStore } from "../infra/quality-store";
import { transitionQualityEvent } from "../domain/quality-state-machine";

type DatabaseRow = Record<string, unknown>;

export function projectQualityEventState(
  eventId: string,
  dbPath = resolveWorkbenchSqlitePath(),
): QualityEventRecord {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 8000");
  try {
    const event = db.prepare("SELECT * FROM quality_events WHERE id = ? AND deleted_at IS NULL")
      .get(eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    const primaryNodeId = String(event.primary_node_id ?? "");
    if (primaryNodeId) {
      const nodes = db.prepare(`
        WITH RECURSIVE tree(node_id,parent_node_id,status) AS (
          SELECT node_id,parent_node_id,status FROM quality_assignment_nodes WHERE node_id = ?
          UNION ALL
          SELECT n.node_id,n.parent_node_id,n.status FROM quality_assignment_nodes n
          JOIN tree p ON n.parent_node_id = p.node_id
          WHERE n.status NOT IN ('REJECTED','CANCELLED')
        ) SELECT * FROM tree
      `).all(primaryNodeId) as DatabaseRow[];
      const root = nodes.find((item) => String(item.node_id) === primaryNodeId);
      const descendantsApproved = nodes
        .filter((item) => String(item.node_id) !== primaryNodeId)
        .every((item) => String(item.status) === "APPROVED");
      const planningV2 = Boolean(db.prepare(`
        SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_planning_sessions'
      `).get()) && Boolean(db.prepare(
        "SELECT 1 FROM quality_planning_sessions WHERE event_id=? AND binding_status='BOUND'",
      ).get(eventId));
      if (planningV2 && root && String(root.status) === "IN_PROGRESS" && descendantsApproved) {
        db.prepare(`
          UPDATE quality_assignment_nodes SET status='PENDING_PARENT_REVIEW',version=version+1,updated_at=?
          WHERE node_id=? AND status='IN_PROGRESS'
        `).run(new Date().toISOString(), primaryNodeId);
        root.status = "PENDING_PARENT_REVIEW";
      }
      if (root && String(root.status) === "PENDING_PARENT_REVIEW" && descendantsApproved
        && String(event.status) === "IN_PROGRESS") {
        const nextStatus = transitionQualityEvent("IN_PROGRESS", "ALL_BRANCHES_APPROVED");
        db.prepare(`
          UPDATE quality_events SET status = ?, version = version + 1,
            updated_at = ? WHERE id = ? AND status = 'IN_PROGRESS'
        `).run(nextStatus, new Date().toISOString(), eventId);
      }
    }
  } finally {
    db.close();
  }
  const store = createQualityStore(dbPath);
  try {
    const event = store.getEvent(eventId);
    if (!event) throw new Error("质量事件不存在");
    return event;
  } finally {
    store.close();
  }
}

export function getQualityEvidencePackage(input: {
  eventId: string;
  viewerUserId: string;
  dbPath?: string;
  isQualitySpecialist?: boolean;
  isAftersalesManager?: boolean;
}) {
  const dbPath = input.dbPath ?? resolveWorkbenchSqlitePath();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  try {
    const event = db.prepare(`
      SELECT id,event_no,status,title,problem_status,created_by,overall_due_at,primary_node_id,version,updated_at
      FROM quality_events WHERE id = ? AND deleted_at IS NULL
    `).get(input.eventId) as DatabaseRow | undefined;
    if (!event) throw new Error("质量事件不存在");
    const primaryNodeId = String(event.primary_node_id ?? "");
    if (!primaryNodeId) throw new Error("质量事件尚未确定原主责");
    const allNodes = db.prepare(`
      WITH RECURSIVE tree AS (
        SELECT * FROM quality_assignment_nodes WHERE node_id = ?
        UNION ALL
        SELECT n.* FROM quality_assignment_nodes n JOIN tree p ON n.parent_node_id = p.node_id
        WHERE n.status <> 'CANCELLED'
      ) SELECT * FROM tree ORDER BY depth,created_at,node_id
    `).all(primaryNodeId) as DatabaseRow[];
    const primary = allNodes.find((row) => String(row.node_id) === primaryNodeId);
    const caps = resolveQualityCapabilities(input.viewerUserId);
    const full = Boolean(input.isQualitySpecialist)
      || caps.hasQualityManagement
      || (Boolean(input.isAftersalesManager) && String(event.created_by) === input.viewerUserId)
      || (caps.roles.includes("aftersales_manager") && String(event.created_by) === input.viewerUserId)
      || String(primary?.assignee_user_id ?? "") === input.viewerUserId;
    const byParent = new Map<string | null, DatabaseRow[]>();
    for (const item of allNodes) {
      const key = item.parent_node_id == null ? null : String(item.parent_node_id);
      const bucket = byParent.get(key) ?? [];
      bucket.push(item);
      byParent.set(key, bucket);
    }
    for (const bucket of byParent.values()) {
      bucket.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.node_id).localeCompare(String(b.node_id)));
    }
    const visible = new Set<string>();
    function includeSubtree(nodeId: string): void {
      if (visible.has(nodeId)) return;
      visible.add(nodeId);
      for (const child of byParent.get(nodeId) ?? []) includeSubtree(String(child.node_id));
    }
    if (full) includeSubtree(primaryNodeId);
    else {
      for (const item of allNodes) {
        if (String(item.assignee_user_id) !== input.viewerUserId) continue;
        if (String(item.assignee_kind) === "MANAGER") includeSubtree(String(item.node_id));
        else visible.add(String(item.node_id));
      }
    }
    if (visible.size === 0) throw new Error("无权查看该质量证据链路");
    const ordered: DatabaseRow[] = [];
    function walk(nodeId: string): void {
      const item = allNodes.find((row) => String(row.node_id) === nodeId);
      if (item && visible.has(nodeId)) ordered.push(item);
      for (const child of byParent.get(nodeId) ?? []) walk(String(child.node_id));
    }
    if (full) walk(primaryNodeId);
    else {
      const visibleRoots = allNodes.filter((item) => visible.has(String(item.node_id))
        && (item.parent_node_id == null || !visible.has(String(item.parent_node_id))));
      for (const root of visibleRoots) walk(String(root.node_id));
    }
    return {
      event: {
        eventId: String(event.id), eventNo: String(event.event_no), status: String(event.status),
        title: String(event.title), eventSummary: String(event.problem_status), overallDueAt: event.overall_due_at == null ? null : String(event.overall_due_at),
        primaryNodeId, version: Number(event.version), updatedAt: String(event.updated_at),
      },
      nodes: ordered.map((item) => {
        const nodeId = String(item.node_id);
        const evidence = (db.prepare(`SELECT * FROM quality_evidence WHERE node_id = ? ORDER BY evidence_version,created_at,evidence_id`).all(nodeId) as DatabaseRow[])
          .map((row) => ({
            evidenceId: String(row.evidence_id), evidenceVersion: Number(row.evidence_version), originalName: String(row.original_name),
            mimeType: String(row.mime_type), summary: String(row.summary ?? ""), sizeBytes: Number(row.size_bytes), sha256: String(row.sha256),
            uploadedBy: String(row.uploaded_by), createdAt: String(row.created_at),
          }));
        const reviews = (db.prepare(`SELECT * FROM quality_node_reviews WHERE node_id = ? ORDER BY created_at,review_id`).all(nodeId) as DatabaseRow[])
          .map((row) => ({
            reviewId: String(row.review_id), reviewerUserId: String(row.reviewer_user_id), decision: String(row.decision),
            reason: row.reason == null ? null : String(row.reason), evidenceVersion: row.evidence_version == null ? null : Number(row.evidence_version),
            createdAt: String(row.created_at),
          }));
        return {
          nodeId, parentNodeId: item.parent_node_id == null ? null : String(item.parent_node_id), depth: Number(item.depth),
          assigneeUserId: String(item.assignee_user_id), assigneeKind: String(item.assignee_kind), departmentName: String(item.department_name),
          isPrimary: Number(item.is_primary) === 1, status: String(item.status), dueAt: String(item.due_at), requirement: String(item.requirement),
          version: Number(item.version), evidence, reviews,
        };
      }),
    };
  } finally {
    db.close();
  }
}
