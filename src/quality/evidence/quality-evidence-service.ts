import { readQualityEmployeeWork } from "./quality-employee-work";
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
import { assignmentNodeFromRow, createQualityStore } from "../infra/quality-store";
import { projectQualityEventState } from "../reviews/quality-event-projector";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  readQualityEventBoundary,
} from "../testing/quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

function evidenceFromRow(row: DatabaseRow): QualityEvidenceRecord {
  return {
    requirementId: row.requirement_id == null ? null : String(row.requirement_id),
    supersedesId: row.supersedes_id == null ? null : String(row.supersedes_id),
    fileRevision: Number(row.file_revision ?? 1),
    submittedAt: row.submitted_at == null ? null : String(row.submitted_at),
    removedAt: row.removed_at == null ? null : String(row.removed_at),
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
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 8000");
  const rootDir = deps?.rootDir
    ?? process.env.QUALITY_EVIDENCE_DIR?.trim()
    ?? join(process.env.QUALITY_FILE_DIR?.trim() || "data/quality-files", "evidence");
  const maxBytes = deps?.maxBytes ?? QUALITY_MAX_FILE_BYTES;
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;
  mkdirSync(rootDir, { recursive: true });
  const formalStore = createWorkbenchFormalTaskStore({ dbPath, database: db });

  function node(nodeId: string): QualityAssignmentNode {
    const row = db.prepare("SELECT * FROM quality_assignment_nodes WHERE node_id=?").get(nodeId);
    if (!row) throw new Error("质量节点不存在");
    return assignmentNodeFromRow(row);
  }

  function listNodeEvidence(nodeId: string): QualityEvidenceRecord[] {
    return (db.prepare(`
      SELECT * FROM quality_evidence WHERE node_id = ?
      ORDER BY evidence_version, created_at, evidence_id
    `).all(nodeId) as DatabaseRow[]).map(evidenceFromRow);
  }

  function currentEvidenceVersion(nodeId: string, _status: string): number {
    const row = db.prepare(`SELECT MAX(evidence_version) AS version FROM quality_node_reviews
      WHERE node_id=? AND decision='RETURN'`).get(nodeId);
    const existing = db.prepare("SELECT MAX(evidence_version) AS version FROM quality_evidence WHERE node_id=?").get(nodeId);
    return Math.max(1, Number(existing?.version ?? 1), row?.version == null ? 1 : Number(row.version) + 1);
  }

  function transaction<T>(run: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try { const result = run(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  function assertEditable(input: { nodeId: string; actorUserId: string; actualAdminUserId?: string }, editable = true) {
    const target = node(input.nodeId);
    const event = readQualityEventBoundary(db, target.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.actorUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    const work = readQualityEmployeeWork(db, input.nodeId);
    if (target.assigneeUserId !== input.actorUserId || (work && work.assigneeUserId !== input.actorUserId))
      throw new Error("仅节点承接人可处理该任务");
    const closed = db.prepare("SELECT status FROM quality_events WHERE id=?").get(target.eventId)?.status === "CLOSED";
    if (editable && (closed || !["IN_PROGRESS", "RETURNED"].includes(target.status) || (work && !work.canEdit)))
      throw new Error("当前任务不可编辑，请刷新状态");
    return { target, event, work };
  }

  function updateProgress(input: {nodeId: string; actorUserId: string; actualAdminUserId?: string; note: string; progressStatus: "IN_PROGRESS" | "BLOCKED"}) {
    return transaction(() => {
      const { work } = assertEditable(input);
      if (!work) throw new Error("质量正式任务桥接不存在");
      return formalStore.updateSubtaskStatus({subtaskId:work.subtaskId,actorUserId:input.actorUserId,
        action:"progress",progressStatus:input.progressStatus,note:z.string().trim().min(1).max(10000).parse(input.note)});
    });
  }

  function saveDraft(input: { nodeId: string; actorUserId: string; actualAdminUserId?: string;
    progress: string; next: string; completion: string; expectedVersion: number }) {
    return transaction(() => {
      assertEditable(input);
      const progress = z.string().max(5000).parse(input.progress);
      const next = z.string().max(5000).parse(input.next);
      const completion = z.string().max(5000).parse(input.completion);
      const previous = db.prepare("SELECT version FROM quality_employee_drafts WHERE node_id=?").get(input.nodeId);
      if (Number(previous?.version ?? 0) !== input.expectedVersion) throw new Error("草稿已更新，请刷新后重试");
      db.prepare(`INSERT INTO quality_employee_drafts(node_id,progress,next_plan,completion_note,version,updated_by,updated_at)
        VALUES(?,?,?,?,1,?,?) ON CONFLICT(node_id) DO UPDATE SET progress=excluded.progress,next_plan=excluded.next_plan,
        completion_note=excluded.completion_note,version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
        .run(input.nodeId,progress,next,completion,input.actorUserId,now());
      return { version: input.expectedVersion + 1 };
    });
  }

  function removeEvidence(input: { nodeId: string; evidenceId: string; actorUserId: string; actualAdminUserId?: string }) {
    return transaction(() => {
      const { target } = assertEditable(input);
      const evidence = db.prepare("SELECT * FROM quality_evidence WHERE evidence_id=? AND node_id=?").get(input.evidenceId,input.nodeId);
      if (!evidence) throw new Error("证据不存在");
      if (evidence.removed_at) return;
      if (evidence.submitted_at) throw new Error("已提交的历史证据不能移除，请上传新版本");
      if (db.prepare("SELECT 1 FROM quality_evidence WHERE supersedes_id=? AND removed_at IS NULL").get(input.evidenceId))
        throw new Error("历史版本不能移除");
      db.prepare("UPDATE quality_evidence SET removed_at=? WHERE evidence_id=?").run(now(),input.evidenceId);
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,after_json,request_id,occurred_at)
        VALUES(?,?,?,'executor','QUALITY_EVIDENCE_REMOVED',?,?,?)`)
        .run(id(),target.eventId,input.actorUserId,JSON.stringify({evidenceId:input.evidenceId,actualOperatorUserId:input.actualAdminUserId}),randomUUID(),now());
    });
  }

  function uploadEvidenceInTransaction(input: {
    nodeId: string;
    actorUserId: string;
    originalName: string;
    mimeType: string;
    summary: string;
    requirementId?: string;
    supersedesId?: string;
    buffer: Buffer;
    requestId: string;
    actualAdminUserId?: string;
  }): QualityEvidenceRecord {
    const requestId = validRequestId(input.requestId);
    const { target, event, work } = assertEditable(input, false);
    const repeated = db.prepare("SELECT * FROM quality_evidence WHERE request_id = ?").get(requestId);
    if (repeated) {
      if (repeated.node_id !== input.nodeId || repeated.uploaded_by !== input.actorUserId)
        throw new Error("请求编号已用于其他操作");
      return evidenceFromRow(repeated);
    }
    assertEditable(input);
    let requirementId = input.requirementId?.trim() || null;
    const previous = input.supersedesId ? db.prepare("SELECT * FROM quality_evidence WHERE evidence_id=? AND node_id=?")
      .get(input.supersedesId,input.nodeId) : undefined;
    if (input.supersedesId) {
      if (!previous || previous.removed_at || db.prepare("SELECT 1 FROM quality_evidence WHERE supersedes_id=? AND removed_at IS NULL").get(input.supersedesId))
        throw new Error("只能为当前有效文件添加新版本");
      if (requirementId && requirementId !== previous.requirement_id) throw new Error("新版本不能改变对应要求");
      requirementId = previous.requirement_id == null ? null : String(previous.requirement_id);
    }
    if (requirementId && !work?.requirements.some(r => r.id === requirementId)) throw new Error("证据要求已变更，请刷新页面");
    const summary = input.summary.trim();
    if (!summary || summary.length > 2000) throw new Error("证据摘要必填且不超过 2000 字");
    const extension = input.originalName.split(".").pop()?.toLowerCase();
    if (!["pdf","png","jpg","jpeg","webp","txt","doc","docx","xls","xlsx","ppt","pptx","zip"].includes(extension ?? "")
      || (!QUALITY_ALLOWED_MIME_TYPES.has(input.mimeType) && !(extension === "zip" && ["application/zip","application/x-zip-compressed"].includes(input.mimeType))))
      throw new Error("证据文件类型不允许（不支持视频）");
    if (!input.buffer.byteLength) throw new Error("不能上传空文件");
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
    if (process.platform !== "win32") {
      const directoryDescriptor = openSync(rootDir, "r");
      try { fsyncSync(directoryDescriptor); } finally { closeSync(directoryDescriptor); }
    }
    try {
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
      db.prepare(`UPDATE quality_evidence SET requirement_id=?,supersedes_id=?,file_revision=? WHERE evidence_id=?`)
        .run(requirementId,input.supersedesId || null,Number(previous?.file_revision ?? 0) + 1,evidenceId);
      db.prepare(`
        INSERT INTO quality_audit_events (
          id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at
        ) VALUES (?,?,?,?,'QUALITY_EVIDENCE_UPLOADED',NULL,?,?,?,?)
      `).run(
        id(),
        target.eventId,
        input.actorUserId,
        target.assigneeKind === "MANAGER" ? "department_manager" : "executor",
        JSON.stringify({ actualOperatorUserId: input.actualAdminUserId, evidenceId, nodeId: target.nodeId, evidenceVersion, originalName, mimeType: input.mimeType, summary, sha256 }),
        summary,
        requestId,
        occurredAt,
      );
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_EVIDENCE_UPLOADED",
        requestId,
        occurredAt,
      });
    } catch (error) {
      unlinkSync(finalPath);
      throw error;
    }
    return evidenceFromRow(db.prepare("SELECT * FROM quality_evidence WHERE evidence_id = ?")
      .get(evidenceId) as DatabaseRow);
  }

  function uploadEvidence(input: Parameters<typeof uploadEvidenceInTransaction>[0]) {
    return transaction(() => uploadEvidenceInTransaction(input));
  }

  function submitCompletionInTransaction(input: {
    nodeId: string;
    actorUserId: string;
    expectedVersion: number;
    completionNote?: string;
    requirementRevision?: string;
    requestId: string;
    actualAdminUserId?: string;
  }) {
    const requestId = validRequestId(input.requestId);
    const checked = assertEditable(input, false);
    let target = checked.target;
    const { event, work } = checked;
    if (target.status === "PENDING_PARENT_REVIEW") {
      return { node: target, evidence: listNodeEvidence(target.nodeId) };
    }
    if (target.status !== "IN_PROGRESS" && target.status !== "RETURNED") {
      throw new Error("当前节点不可提交完成");
    }
    assertEditable(input);
    if (target.version !== input.expectedVersion) throw new Error("version conflict");
    const completionNote = z.string().max(5000).parse(input.completionNote ?? work?.draft.completion ?? "").trim();
    if (work && !completionNote) throw new Error("请填写完成说明");
    if (work && input.requirementRevision && work.requirementRevision !== input.requirementRevision)
      throw new Error("分配要求已变更，请刷新后重新核对");
    if (work) {
      const missing = work.requirements.filter(r => !work.files.some(f => f.current && f.requirementId === r.id));
      if (missing.length) throw new Error("还缺少必交证据：" + missing.map(r => r.name).join("、"));
    }
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
        SELECT COUNT(*) AS total FROM quality_evidence WHERE node_id = ? AND evidence_version = ? AND removed_at IS NULL
      `).get(target.nodeId, version) as DatabaseRow;
      if (Number(count.total) < 1) throw new Error("质量任务完成前必须上传证据");
    }
    const occurredAt = now();
    const eventRow = db.prepare("SELECT event_no,title FROM quality_events WHERE id=?").get(target.eventId) as DatabaseRow;
    const parentRow = target.parentNodeId
      ? db.prepare("SELECT assignee_user_id FROM quality_assignment_nodes WHERE node_id=?").get(target.parentNodeId) as DatabaseRow | undefined
      : undefined;
    {
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
        JSON.stringify({ actualOperatorUserId: input.actualAdminUserId, status: "PENDING_PARENT_REVIEW", completionNote, requirements: work?.requirements, evidenceCount: listNodeEvidence(target.nodeId).filter(f => !f.removedAt).length }),
        requestId,
        occurredAt,
      );
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_NODE_COMPLETION_SUBMITTED",
        requestId,
        occurredAt,
      });
      enqueueQualityActionNotifications(db, {
        eventId: target.eventId, eventNo: String(eventRow.event_no), action: "NODE_EVIDENCE_SUBMITTED", actionId: requestId,
        context: { directParentUserId: parentRow ? String(parentRow.assignee_user_id) : null }, subject: "下级质量证据待验收",
        summary: `${String(eventRow.title)}；节点 ${target.assigneeUserId} 已提交完成`, occurredAt,
      });
      if (work) {
        formalStore.updateSubtaskStatus({ subtaskId: work.subtaskId, actorUserId: input.actorUserId,
          action: "progress", progressStatus: "DONE", note: completionNote });
        db.prepare(`INSERT INTO quality_employee_drafts(node_id,completion_note,updated_by,updated_at)
          VALUES(?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET completion_note=excluded.completion_note,
          version=version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
          .run(input.nodeId,completionNote,input.actorUserId,occurredAt);
      } else if (!event.isTest && target.parentNodeId) throw new Error("质量正式任务桥接不存在");
      db.prepare("UPDATE quality_evidence SET submitted_at=COALESCE(submitted_at,?) WHERE node_id=? AND removed_at IS NULL")
        .run(occurredAt,target.nodeId);
    }
    return { node: { ...target, status: "PENDING_PARENT_REVIEW", version: target.version + 1 }, evidence: listNodeEvidence(target.nodeId) };
  }

  function submitCompletion(input: Parameters<typeof submitCompletionInTransaction>[0]) {
    const result = transaction(() => submitCompletionInTransaction(input));
    projectQualityEventState(result.node.eventId, dbPath);
    return result;
  }

  function readEvidence(input: {
    evidenceId: string;
    actorUserId: string;
    actorRole?: "admin" | "aftersales_manager" | "quality_specialist";
  }) {
    const row = db.prepare(`
      SELECT q.*, e.created_by, e.deleted_at FROM quality_evidence q
      JOIN quality_events e ON e.id = q.event_id
      WHERE q.evidence_id = ? AND e.deleted_at IS NULL
    `).get(input.evidenceId) as DatabaseRow | undefined;
    if (!row) throw new Error("证据不存在");
    let visible = input.actorRole === "admin"
      || input.actorRole === "quality_specialist"
      || (input.actorRole === "aftersales_manager" && String(row.created_by) === input.actorUserId);
    if (!visible) {
      visible = Boolean(db.prepare(`
        WITH RECURSIVE lineage(node_id,parent_node_id,assignee_user_id) AS (
          SELECT node_id,parent_node_id,assignee_user_id FROM quality_assignment_nodes WHERE node_id = ?
          UNION ALL
          SELECT p.node_id,p.parent_node_id,p.assignee_user_id
          FROM quality_assignment_nodes p JOIN lineage c ON c.parent_node_id = p.node_id
        )
        SELECT 1 FROM lineage WHERE assignee_user_id = ? AND (
          node_id<>? OR NOT EXISTS(SELECT 1 FROM quality_task_links WHERE node_id=lineage.node_id)
          OR EXISTS(SELECT 1 FROM quality_task_links l JOIN subtasks s ON s.subtask_id=l.subtask_id
            WHERE l.node_id=lineage.node_id AND s.assignee_user_id=?)
        ) LIMIT 1
      `).get(String(row.node_id), input.actorUserId, String(row.node_id), input.actorUserId));
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
    updateProgress,
    saveDraft,
    removeEvidence,
    submitCompletion,
    listNodeEvidence,
    readEvidence,
    close: () => db.close(),
  };
}
