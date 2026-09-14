import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Formal deliverables remain authoritative. Only explicit list separators split items. */
export function qualityEvidenceRequirements(subtaskId: string, deliverables: string) {
  let names: string[];
  try {
    const parsed: unknown = JSON.parse(deliverables);
    names = Array.isArray(parsed) && parsed.every(x => typeof x === "string") ? parsed : [deliverables];
  } catch { names = deliverables.split(/\r?\n|[；;]/); }
  names = [...new Set(names.map(x => x.replace(/^\s*(?:[-*•]|\d+[.)、])\s*/, "").trim()).filter(Boolean))];
  return names.map(name => ({
    id: createHash("sha256").update(`${subtaskId}\n${name}`).digest("hex").slice(0, 32),
    name,
  }));
}

export function readQualityEmployeeWork(db: DatabaseSync, nodeId: string) {
  const link = db.prepare("SELECT subtask_id FROM quality_task_links WHERE node_id=?").get(nodeId);
  if (!link) return null;
  const row = db.prepare(`SELECT s.*,t.task_no,t.manager_user_id,n.status AS node_status,n.version AS node_version,
    n.department_name,e.status AS event_status,e.deleted_at
    FROM subtasks s JOIN tasks t ON t.task_id=s.task_id
    JOIN quality_task_links l ON l.subtask_id=s.subtask_id JOIN quality_assignment_nodes n ON n.node_id=l.node_id
    JOIN quality_events e ON e.id=n.event_id WHERE l.node_id=?`).get(nodeId);
  if (!row || row.deleted_at) return null;
  const requirements = qualityEvidenceRequirements(String(row.subtask_id), String(row.deliverables ?? ""));
  const files = db.prepare(`SELECT evidence_id AS evidenceId,original_name AS fileName,mime_type AS mimeType,
    summary,size_bytes AS sizeBytes,created_at AS createdAt,requirement_id AS requirementId,
    supersedes_id AS supersedesId,file_revision AS fileRevision,submitted_at AS submittedAt,removed_at AS removedAt
    FROM quality_evidence WHERE node_id=? ORDER BY created_at,evidence_id`).all(nodeId) as Array<{ evidenceId: string; fileName: string; mimeType: string; summary: string; sizeBytes: number; createdAt: string; requirementId: string | null; supersedesId: string | null; fileRevision: number; submittedAt: string | null; removedAt: string | null }>;
  const replaced = new Set(files.filter(x => !x.removedAt).map(x => x.supersedesId).filter(Boolean));
  const draft = db.prepare("SELECT * FROM quality_employee_drafts WHERE node_id=?").get(nodeId);
  const reviews = db.prepare(`SELECT decision,reason,reviewer_user_id AS reviewerUserId,created_at AS createdAt
    FROM quality_node_reviews WHERE node_id=? ORDER BY created_at DESC,review_id DESC`).all(nodeId);
  const history = db.prepare(`SELECT event_type AS action,note,occurred_at AS occurredAt FROM task_events
    WHERE subtask_id=? ORDER BY occurred_at DESC,id DESC LIMIT 30`).all(String(row.subtask_id));
  return {
    nodeId, subtaskId: String(row.subtask_id), taskNo: String(row.task_no), title: String(row.title),
    assigneeUserId: String(row.assignee_user_id), managerUserId: String(row.manager_user_id),
    objective: String(row.objective ?? ""), deliverables: String(row.deliverables ?? ""),
    completionCriteria: String(row.completion_criteria ?? ""), dueAt: row.due_at,
    departmentName: String(row.department_name ?? ""), formalStatus: String(row.status),
    nodeStatus: String(row.node_status), nodeVersion: Number(row.node_version), eventStatus: String(row.event_status),
    canEdit: row.event_status !== "CLOSED" && ["IN_PROGRESS", "BLOCKED"].includes(String(row.status))
      && ["IN_PROGRESS", "RETURNED"].includes(String(row.node_status)),
    requirements,
    requirementRevision: createHash("sha256").update(JSON.stringify([row.deliverables,row.completion_criteria,row.due_at])).digest("hex"),
    files: files.map(x => ({ ...x, current: !x.removedAt && !replaced.has(x.evidenceId) })),
    draft: { progress: String(draft?.progress ?? ""), next: String(draft?.next_plan ?? ""),
      completion: String(draft?.completion_note ?? ""), version: Number(draft?.version ?? 0) },
    progressNote: String(row.progress_note ?? ""), reviews, history,
  };
}
