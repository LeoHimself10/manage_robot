import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { QualityAssignmentNode, QualityEvidenceRecord } from "../domain/quality-types";
import {
  cleanQualityOriginalName,
  QUALITY_ALLOWED_MIME_TYPES,
  QUALITY_MAX_FILE_BYTES,
} from "../files/quality-report-file-store";
import { createQualityStore } from "../infra/quality-store";
import { projectQualityEventState } from "../reviews/quality-event-projector";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";

type DatabaseRow = Record<string, unknown>;

function evidenceFromRow(row: DatabaseRow): QualityEvidenceRecord {
  return {
    evidenceId: String(row.evidence_id),
    eventId: String(row.event_id),
    nodeId: String(row.node_id),
    evidenceVersion: Number(row.evidence_version),
    storageKey: String(row.storage_key),
    originalName: String(row.original_name),
    mimeType: String(row.mime_type),
    summary: String(row.summary ?? ""),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    uploadedBy: String(row.uploaded_by),
    requestId: String(row.request_id ?? ""),
    createdAt: String(row.created_at),
  };
}

function validRequestId(value: string): string {
  return z.string().uuid().parse(value);
}

export function createQualityEvidenceService(deps?: {
  dbPath?: string;
  rootDir?: string;
  maxBytes?: number;
  now?: () => string;
  id?: () => string;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createWorkbenchFormalTaskStore();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 8000");
  const formal = createWorkbenchFormalTaskStore();
  const rootDir = deps?.rootDir
    ?? process.env.QUALITY_EVIDENCE_DIR?.trim()
    ?? join(process.env.QUALITY_FILE_DIR?.trim() || "data/quality-files", "evidence");
  const maxBytes = deps?.maxBytes ?? QUALITY_MAX_FILE_BYTES;
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;
  mkdirSync(rootDir, { recursive: true });

  function node(nodeId: string): QualityAssignmentNode {
    const store = createQualityStore(dbPath);
    try {
      const value = store.getAssignmentNode(nodeId);
      if (!value) throw new Error("质量节点不存在");
      return value;
    } finally {
      store.close();
    }
  }

  function listNodeEvidence(nodeId: string): QualityEvidenceRecord[] {
    return (db.prepare(`
      SELECT * FROM quality_evidence WHERE node_id = ?
      ORDER BY evidence_version, created_at, evidence_id
    `).all(nodeId) as DatabaseRow[]).map(evidenceFromRow);
  }

  function currentEvidenceVersion(nodeId: string, status: string): number {
    if (status !== "RETURNED") return 1;
    const row = db.prepare(`
      SELECT MAX(evidence_version) AS evidence_version
      FROM quality_node_reviews WHERE node_id = ? AND decision = 'RETURN'
    `).get(nodeId) as DatabaseRow;
    return Math.max(1, Number(row.evidence_version ?? 1) + 1);
  }

  function uploadEvidence(input: {
    nodeId: string;
    actorUserId: string;
    originalName: string;
    mimeType: string;
    summary: string;
    buffer: Buffer;
    requestId: string;
  }): QualityEvidenceRecord {
    const requestId = validRequestId(input.requestId);
    const repeated = db.prepare("SELECT * FROM quality_evidence WHERE request_id = ?")
      .get(requestId) as DatabaseRow | undefined;
    if (repeated) return evidenceFromRow(repeated);
    const target = node(input.nodeId);
    if (target.assigneeUserId !== input.actorUserId) throw new Error("仅节点承接人可上传证据");
    if (target.status !== "IN_PROGRESS" && target.status !== "RETURNED") {
      throw new Error("当前节点不可上传证据");
    }
    const summary = input.summary.trim();
    if (!summary || summary.length > 2000) throw new Error("证据摘要必填且不超过 2000 字");
    if (!QUALITY_ALLOWED_MIME_TYPES.has(input.mimeType)) throw new Error("证据文件类型不允许");
    if (input.buffer.byteLength > maxBytes) throw new Error("证据文件超过 20 MB 上限");
    const originalName = cleanQualityOriginalName(input.originalName);
    const evidenceId = id();
    const storageKey = id();
    const evidenceVersion = currentEvidenceVersion(target.nodeId, target.status);
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");
    const occurredAt = now();
    const tempPath = join(rootDir, `.tmp-${storageKey}`);
    const finalPath = join(rootDir, storageKey);
    const fileDescriptor = openSync(tempPath, "wx", 0o600);
    try {
      writeSync(fileDescriptor, input.buffer);
      fsyncSync(fileDescriptor);
    } finally {
      closeSync(fileDescriptor);
    }
    renameSync(tempPath, finalPath);
    const directoryDescriptor = openSync(rootDir, "r");
    try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare(`
        INSERT INTO quality_evidence (
          evidence_id,event_id,node_id,evidence_version,storage_key,original_name,
          mime_type,summary,size_bytes,sha256,uploaded_by,request_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        evidenceId,
        target.eventId,
        target.nodeId,
        evidenceVersion,
        storageKey,
        originalName,
        input.mimeType,
        summary,
        input.buffer.byteLength,
        sha256,
        input.actorUserId,
        requestId,
        occurredAt,
      );
      db.prepare(`
        INSERT INTO quality_audit_events (
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
        ) VALUES (?,?,?,?,'QUALITY_EVIDENCE_UPLOADED',NULL,?,?,?,?)
      `).run(
        id(),
        target.eventId,
        input.actorUserId,
        target.assigneeKind === "MANAGER" ? "department_manager" : "executor",
        JSON.stringify({ evidenceId, nodeId: target.nodeId, evidenceVersion, originalName, mimeType: input.mimeType, summary, sha256 }),
        summary,
        requestId,
        occurredAt,
      );
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
      unlinkSync(finalPath);
      throw error;
    }
    return evidenceFromRow(db.prepare("SELECT * FROM quality_evidence WHERE evidence_id = ?")
      .get(evidenceId) as DatabaseRow);
  }

  function submitCompletion(input: {
    nodeId: string;
    actorUserId: string;
    expectedVersion: number;
    requestId: string;
  }) {
    const requestId = validRequestId(input.requestId);
    let target = node(input.nodeId);
    if (target.assigneeUserId !== input.actorUserId) throw new Error("仅节点承接人可提交完成");
    if (target.status === "PENDING_PARENT_REVIEW") {
      return { node: target, evidence: listNodeEvidence(target.nodeId) };
    }
    if (target.status !== "IN_PROGRESS" && target.status !== "RETURNED") {
      throw new Error("当前节点不可提交完成");
    }
    if (target.version !== input.expectedVersion) throw new Error("version conflict");
    const children = (db.prepare(`
      SELECT status FROM quality_assignment_nodes
      WHERE parent_node_id = ? AND status NOT IN ('REJECTED','CANCELLED')
    `).all(target.nodeId) as DatabaseRow[]);
    if (children.length > 0) {
      if (children.some((child) => String(child.status) !== "APPROVED")) {
        throw new Error("所有直接子节点通过后才能提交汇总");
      }
    } else {
      const version = currentEvidenceVersion(target.nodeId, target.status);
      const count = db.prepare(`
        SELECT COUNT(*) AS total FROM quality_evidence WHERE node_id = ? AND evidence_version = ?
      `).get(target.nodeId, version) as DatabaseRow;
      if (Number(count.total) < 1) throw new Error("质量任务完成前必须上传证据");
    }
    const occurredAt = now();
    const eventRow = db.prepare("SELECT event_no,title FROM quality_events WHERE id=?").get(target.eventId) as DatabaseRow;
    const parentRow = target.parentNodeId
      ? db.prepare("SELECT assignee_user_id FROM quality_assignment_nodes WHERE node_id=?").get(target.parentNodeId) as DatabaseRow | undefined
      : undefined;
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db.prepare(`
        UPDATE quality_assignment_nodes SET status = 'PENDING_PARENT_REVIEW', submitted_at = ?,
          version = version + 1, updated_at = ?
        WHERE node_id = ? AND version = ? AND status IN ('IN_PROGRESS','RETURNED')
      `).run(occurredAt, occurredAt, target.nodeId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        INSERT INTO quality_audit_events (
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
        ) VALUES (?,?,?,?,'QUALITY_NODE_COMPLETION_SUBMITTED',?,?,NULL,?,?)
      `).run(
        id(),
        target.eventId,
        input.actorUserId,
        target.assigneeKind === "MANAGER" ? "department_manager" : "executor",
        JSON.stringify({ status: target.status, version: target.version }),
        JSON.stringify({ status: "PENDING_PARENT_REVIEW", evidenceCount: listNodeEvidence(target.nodeId).length }),
        requestId,
        occurredAt,
      );
      enqueueQualityActionNotifications(db, {
        eventId: target.eventId, eventNo: String(eventRow.event_no), action: "NODE_EVIDENCE_SUBMITTED", actionId: requestId,
        context: { directParentUserId: parentRow ? String(parentRow.assignee_user_id) : null }, subject: "下级质量证据待验收",
        summary: `${String(eventRow.title)}；节点 ${target.assigneeUserId} 已提交完成`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const link = db.prepare("SELECT subtask_id FROM quality_task_links WHERE node_id = ?")
      .get(target.nodeId) as DatabaseRow | undefined;
    if (!link) throw new Error("质量正式任务桥接不存在");
    formal.updateSubtaskStatus({
      subtaskId: String(link.subtask_id),
      actorUserId: input.actorUserId,
      action: "progress",
      progressStatus: "DONE",
      note: "质量证据已提交，等待直接上级验收",
    });
    projectQualityEventState(target.eventId, dbPath);
    target = node(target.nodeId);
    return { node: target, evidence: listNodeEvidence(target.nodeId) };
  }

  function readEvidence(input: {
    evidenceId: string;
    actorUserId: string;
    actorRole?: "aftersales_manager" | "quality_specialist";
  }) {
    const row = db.prepare(`
      SELECT q.*, e.created_by, e.deleted_at FROM quality_evidence q
      JOIN quality_events e ON e.id = q.event_id
      WHERE q.evidence_id = ? AND e.deleted_at IS NULL
    `).get(input.evidenceId) as DatabaseRow | undefined;
    if (!row) throw new Error("证据不存在");
    let visible = input.actorRole === "quality_specialist"
      || (input.actorRole === "aftersales_manager" && String(row.created_by) === input.actorUserId);
    if (!visible) {
      visible = Boolean(db.prepare(`
        WITH RECURSIVE lineage(node_id,parent_node_id,assignee_user_id) AS (
          SELECT node_id,parent_node_id,assignee_user_id FROM quality_assignment_nodes WHERE node_id = ?
          UNION ALL
          SELECT p.node_id,p.parent_node_id,p.assignee_user_id
          FROM quality_assignment_nodes p JOIN lineage c ON c.parent_node_id = p.node_id
        )
        SELECT 1 FROM lineage WHERE assignee_user_id = ? LIMIT 1
      `).get(String(row.node_id), input.actorUserId));
    }
    if (!visible) throw new Error("无权下载该质量证据");
    const metadata = evidenceFromRow(row);
    const buffer = readFileSync(join(rootDir, metadata.storageKey));
    if (createHash("sha256").update(buffer).digest("hex") !== metadata.sha256) {
      throw new Error("证据文件校验失败");
    }
    return { metadata, buffer };
  }

  return {
    uploadEvidence,
    submitCompletion,
    listNodeEvidence,
    readEvidence,
    close: () => db.close(),
  };
}
