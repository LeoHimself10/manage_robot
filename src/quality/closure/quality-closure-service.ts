import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import { computeQualityReturnImpact, transitionQualityEvent } from "../domain/quality-state-machine";
import type { QualityAssignmentNode, QualityEventRecord } from "../domain/quality-types";
import { createQualityStore } from "../infra/quality-store";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";

type DatabaseRow = Record<string, unknown>;

export function createQualityClosureService(deps?: { dbPath?: string; now?: () => string; id?: () => string }) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createWorkbenchFormalTaskStore(); createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON"); db.exec("PRAGMA busy_timeout = 8000");
  const formal = createWorkbenchFormalTaskStore();
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function requireSpecialist(userId: string): void {
    if (!resolveQualityCapabilities(userId).roles.includes("quality_specialist")) {
      throw new Error("仅质量专员可执行终验、关闭或重开");
    }
  }
  function getEvent(eventId: string): QualityEventRecord {
    const store = createQualityStore(dbPath);
    try { const event = store.getEvent(eventId); if (!event) throw new Error("质量事件不存在"); return event; }
    finally { store.close(); }
  }
  function getNode(nodeId: string): QualityAssignmentNode {
    const store = createQualityStore(dbPath);
    try { const node = store.getAssignmentNode(nodeId); if (!node) throw new Error("质量节点不存在"); return node; }
    finally { store.close(); }
  }
  function evidenceVersion(nodeId: string): number | null {
    const row = db.prepare("SELECT MAX(evidence_version) AS version FROM quality_evidence WHERE node_id = ?").get(nodeId) as DatabaseRow;
    return row.version == null ? null : Number(row.version);
  }
  function reopenFormal(nodeId: string, reason: string): void {
    const node = getNode(nodeId);
    const link = db.prepare("SELECT subtask_id FROM quality_task_links WHERE node_id = ?").get(nodeId) as DatabaseRow | undefined;
    if (!link) return;
    formal.updateSubtaskStatus({ subtaskId: String(link.subtask_id), actorUserId: node.assigneeUserId, action: "progress", progressStatus: "IN_PROGRESS", note: reason });
  }
  function nodesForEvent(eventId: string) {
    return (db.prepare(`SELECT node_id,parent_node_id,status,event_id FROM quality_assignment_nodes WHERE event_id = ? AND status <> 'CANCELLED'`).all(eventId) as DatabaseRow[])
      .map((row) => ({ nodeId: String(row.node_id), parentNodeId: row.parent_node_id == null ? null : String(row.parent_node_id), status: String(row.status) }));
  }

  function returnNode(input: {
    event: QualityEventRecord;
    nodeId: string;
    specialistUserId: string;
    reason: string;
    expectedVersion: number;
    requestId: string;
    action: "QUALITY_RETURN_NODE" | "QUALITY_REOPEN";
  }) {
    const requestId = z.string().uuid().parse(input.requestId);
    const repeated = db.prepare("SELECT after_json FROM quality_audit_events WHERE request_id = ? AND action IN ('QUALITY_RETURNED_NODE','QUALITY_REOPENED') LIMIT 1")
      .get(requestId) as DatabaseRow | undefined;
    if (repeated) {
      let affectedNodeIds: string[] = [];
      try { affectedNodeIds = JSON.parse(String(repeated.after_json ?? "{}")).affectedNodeIds ?? []; } catch { /* safe empty */ }
      return { event: getEvent(input.event.eventId), affectedNodeIds };
    }
    const target = getNode(input.nodeId);
    if (target.eventId !== input.event.eventId) throw new Error("指定节点不属于当前质量事件");
    if (input.event.version !== input.expectedVersion) throw new Error("version conflict");
    const reason = input.reason.trim();
    if (!reason) throw new Error(input.action === "QUALITY_REOPEN" ? "重开原因必填" : "退回原因必填");
    const impact = computeQualityReturnImpact(nodesForEvent(input.event.eventId), target.nodeId);
    const nextStatus = transitionQualityEvent(input.event.status, input.action);
    const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE quality_assignment_nodes SET status='RETURNED',version=version+1,updated_at=? WHERE node_id=?")
        .run(occurredAt, target.nodeId);
      for (const nodeId of impact.reopenedAncestorNodeIds) {
        db.prepare("UPDATE quality_assignment_nodes SET status='IN_PROGRESS',version=version+1,updated_at=? WHERE node_id=?")
          .run(occurredAt, nodeId);
      }
      db.prepare(`INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at) VALUES (?,?,?,?,'RETURN',?,?,?,?)`)
        .run(id(), input.event.eventId, target.nodeId, input.specialistUserId, reason, evidenceVersion(target.nodeId), requestId, occurredAt);
      const updated = db.prepare("UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(nextStatus, occurredAt, input.event.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      const auditAction = input.action === "QUALITY_REOPEN" ? "QUALITY_REOPENED" : "QUALITY_RETURNED_NODE";
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES (?,?,?,'quality_specialist',?,?,?,?,?,?)`)
        .run(id(), input.event.eventId, input.specialistUserId, auditAction, JSON.stringify({ status: input.event.status }), JSON.stringify({ status: nextStatus, returnedNodeId: target.nodeId, affectedNodeIds: impact.affectedNodeIds }), reason, requestId, occurredAt);
      const primary = input.event.primaryNodeId ? getNode(input.event.primaryNodeId) : null;
      enqueueQualityActionNotifications(db, {
        eventId: input.event.eventId, eventNo: input.event.eventNo, action: "QUALITY_RETURNED", actionId: requestId,
        context: { aftersalesManagerUserId: input.event.createdBy, primaryManagerUserId: primary?.assigneeUserId, returnedAssigneeUserId: target.assigneeUserId },
        subject: input.action === "QUALITY_REOPEN" ? "质量事件已重开" : "质量事件被质量专员退回",
        summary: `${input.event.title}；原因：${reason}`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    for (const nodeId of impact.affectedNodeIds) reopenFormal(nodeId, reason);
    return { event: getEvent(input.event.eventId), affectedNodeIds: impact.affectedNodeIds };
  }

  function returnSpecificNode(input: { eventId: string; nodeId: string; specialistUserId: string; reason: string; expectedVersion: number; requestId: string }) {
    requireSpecialist(input.specialistUserId);
    const event = getEvent(input.eventId);
    if (event.status !== "PENDING_QUALITY_REVIEW") throw new Error("质量事件当前不可指定节点退回");
    return returnNode({ ...input, event, action: "QUALITY_RETURN_NODE" });
  }

  function closeEvent(input: { eventId: string; specialistUserId: string; conclusion: string; expectedVersion: number; requestId: string }): QualityEventRecord {
    requireSpecialist(input.specialistUserId);
    const requestId = z.string().uuid().parse(input.requestId);
    if (db.prepare("SELECT 1 FROM quality_audit_events WHERE request_id = ? AND action = 'QUALITY_CLOSED'").get(requestId)) return getEvent(input.eventId);
    const event = getEvent(input.eventId);
    if (event.status !== "PENDING_QUALITY_REVIEW") throw new Error("质量事件当前不可关闭");
    if (event.version !== input.expectedVersion) throw new Error("version conflict");
    const conclusion = input.conclusion.trim();
    if (!conclusion || conclusion.length > 10000) throw new Error("关闭结论必填且不超过 10000 字");
    const nodes = db.prepare("SELECT node_id,status FROM quality_assignment_nodes WHERE event_id=? AND status NOT IN ('REJECTED','CANCELLED')")
      .all(event.eventId) as DatabaseRow[];
    if (nodes.length === 0 || nodes.some((node) => String(node.status) !== "APPROVED")) throw new Error("全链节点尚未全部验收通过");
    const leafWithoutEvidence = db.prepare(`
      SELECT n.node_id FROM quality_assignment_nodes n
      WHERE n.event_id=? AND n.status='APPROVED'
        AND NOT EXISTS (SELECT 1 FROM quality_assignment_nodes c WHERE c.parent_node_id=n.node_id AND c.status NOT IN ('REJECTED','CANCELLED'))
        AND NOT EXISTS (SELECT 1 FROM quality_evidence e WHERE e.node_id=n.node_id)
      LIMIT 1
    `).get(event.eventId);
    if (leafWithoutEvidence) throw new Error("有效叶子节点证据不完整");
    const nextStatus = transitionQualityEvent(event.status, "QUALITY_CLOSE");
    const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db.prepare("UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(nextStatus, occurredAt, event.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES (?,?,?,'quality_specialist','QUALITY_CLOSED',?,?,?,?,?)`)
        .run(id(), event.eventId, input.specialistUserId, JSON.stringify({ status: event.status }), JSON.stringify({ status: nextStatus, conclusion }), conclusion, requestId, occurredAt);
      const primary = event.primaryNodeId ? getNode(event.primaryNodeId) : null;
      enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "QUALITY_CLOSED", actionId: requestId,
        context: { aftersalesManagerUserId: event.createdBy, primaryManagerUserId: primary?.assigneeUserId },
        subject: "质量事件已关闭", summary: `${event.title}；终验结论：${conclusion}`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return getEvent(event.eventId);
  }

  function reopenEvent(input: { eventId: string; nodeId: string; specialistUserId: string; reason: string; expectedVersion: number; requestId: string }) {
    requireSpecialist(input.specialistUserId);
    const event = getEvent(input.eventId);
    if (event.status !== "CLOSED") throw new Error("仅已关闭质量事件可重开");
    return returnNode({ ...input, event, action: "QUALITY_REOPEN" });
  }

  return { returnSpecificNode, closeEvent, reopenEvent, getEvent, close: () => db.close() };
}
