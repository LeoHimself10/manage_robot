import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { QualityAssignmentNode, QualityEventRecord } from "../domain/quality-types";
import { createQualityStore } from "../infra/quality-store";
import { projectQualityEventState } from "./quality-event-projector";
import { transitionQualityEvent } from "../domain/quality-state-machine";
import { listQualitySpecialistUserIds } from "../../security/quality-capabilities";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  testQualitySpecialistUserIds,
} from "../testing/quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

export function createQualityReviewService(deps?: { dbPath?: string; now?: () => string; id?: () => string }) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;

  function getNode(nodeId: string): QualityAssignmentNode {
    const store = createQualityStore(dbPath);
    try {
      const node = store.getAssignmentNode(nodeId);
      if (!node) throw new Error("质量节点不存在");
      return node;
    } finally { store.close(); }
  }

  function getEvent(eventId: string): QualityEventRecord {
    const store = createQualityStore(dbPath);
    try {
      const event = store.getEvent(eventId);
      if (!event) throw new Error("质量事件不存在");
      return event;
    } finally { store.close(); }
  }

  function evidenceVersion(nodeId: string): number | null {
    const row = db.prepare("SELECT MAX(evidence_version) AS version FROM quality_evidence WHERE node_id = ?")
      .get(nodeId) as DatabaseRow;
    return row.version == null ? null : Number(row.version);
  }

  function reopenFormalTask(node: QualityAssignmentNode, note: string): void {
    const link = db.prepare("SELECT subtask_id FROM quality_task_links WHERE node_id = ?")
      .get(node.nodeId) as DatabaseRow | undefined;
    if (!link) return;
    createWorkbenchFormalTaskStore().updateSubtaskStatus({
      subtaskId: String(link.subtask_id), actorUserId: node.assigneeUserId,
      action: "progress", progressStatus: "IN_PROGRESS", note,
    });
  }

  function reviewDirectChild(input: {
    childNodeId: string;
    actorUserId: string;
    decision: "APPROVE" | "RETURN";
    reason?: string;
    expectedVersion: number;
    requestId: string;
    actualAdminUserId?: string;
  }): QualityAssignmentNode {
    const requestId = z.string().uuid().parse(input.requestId);
    const repeated = db.prepare("SELECT node_id FROM quality_node_reviews WHERE request_id = ?")
      .get(requestId) as DatabaseRow | undefined;
    if (repeated) return getNode(String(repeated.node_id));
    const child = getNode(input.childNodeId);
    const event = getEvent(child.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.actorUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (!child.parentNodeId) throw new Error("根节点不属于直接上级验收");
    const parent = getNode(child.parentNodeId);
    if (parent.assigneeUserId !== input.actorUserId) throw new Error("仅直接上级承接人可验收该节点");
    if (child.status !== "PENDING_PARENT_REVIEW") throw new Error("当前节点不在待上级验收状态");
    if (child.version !== input.expectedVersion) throw new Error("version conflict");
    const reason = String(input.reason ?? "").trim();
    if (input.decision === "RETURN" && !reason) throw new Error("退回原因必填");
    const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      const nextStatus = input.decision === "APPROVE" ? "APPROVED" : "RETURNED";
      const updated = db.prepare(`
        UPDATE quality_assignment_nodes SET status = ?, version = version + 1, updated_at = ?
        WHERE node_id = ? AND status = 'PENDING_PARENT_REVIEW' AND version = ?
      `).run(nextStatus, occurredAt, child.nodeId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(id(), child.eventId, child.nodeId, input.actorUserId, input.decision, reason || null, evidenceVersion(child.nodeId), requestId, occurredAt);
      db.prepare(`
        INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at)
        VALUES (?,?,?,'department_manager','QUALITY_DIRECT_CHILD_REVIEWED',?,?,?,?,?)
      `).run(id(), child.eventId, input.actorUserId, JSON.stringify({ nodeId: child.nodeId, status: child.status }), JSON.stringify({ status: nextStatus, decision: input.decision }), reason || null, requestId, occurredAt);
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_DIRECT_CHILD_REVIEWED",
        requestId,
        occurredAt,
      });
      if (input.decision === "RETURN") enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "NODE_RETURNED", actionId: requestId,
        context: { returnedAssigneeUserId: child.assigneeUserId }, subject: "质量节点证据被退回",
        summary: `${event.title}；退回原因：${reason}`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (input.decision === "RETURN") reopenFormalTask(child, `质量证据被直接上级退回：${reason}`);
    projectQualityEventState(child.eventId, dbPath);
    return getNode(child.nodeId);
  }

  function primaryReview(input: {
    eventId: string;
    primaryManagerUserId: string;
    decision: "APPROVE" | "RETURN_NODE";
    returnedNodeId?: string;
    reason?: string;
    expectedVersion: number;
    requestId: string;
    actualAdminUserId?: string;
  }): QualityEventRecord {
    const requestId = z.string().uuid().parse(input.requestId);
    if (db.prepare("SELECT 1 FROM quality_audit_events WHERE request_id = ? LIMIT 1").get(requestId)
      || db.prepare("SELECT 1 FROM quality_node_reviews WHERE request_id = ? LIMIT 1").get(requestId)) {
      return getEvent(input.eventId);
    }
    const event = getEvent(input.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.primaryManagerUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (!event.primaryNodeId) throw new Error("原主责节点不存在");
    const primary = getNode(event.primaryNodeId);
    if (primary.assigneeUserId !== input.primaryManagerUserId) throw new Error("仅原主责可执行整体验收");
    if (event.status !== "PENDING_PRIMARY_REVIEW") throw new Error("质量事件当前不可整体验收");
    if (event.version !== input.expectedVersion) throw new Error("version conflict");
    const reason = String(input.reason ?? "").trim();
    const occurredAt = now();
    if (input.decision === "APPROVE") {
      const nextStatus = transitionQualityEvent(event.status, "PRIMARY_APPROVE");
      db.exec("BEGIN IMMEDIATE");
      try {
        const updated = db.prepare(`UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND status='PENDING_PRIMARY_REVIEW' AND version=?`)
          .run(nextStatus, occurredAt, event.eventId, input.expectedVersion);
        if (Number(updated.changes) !== 1) throw new Error("version conflict");
        db.prepare("UPDATE quality_assignment_nodes SET status='APPROVED',version=version+1,updated_at=? WHERE node_id=?")
          .run(occurredAt, primary.nodeId);
        db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES (?,?,?,'department_manager','QUALITY_PRIMARY_APPROVED',?,?,NULL,?,?)`)
          .run(id(), event.eventId, input.primaryManagerUserId, JSON.stringify({ status: event.status }), JSON.stringify({ status: nextStatus }), requestId, occurredAt);
        if (event.isTest) appendQualityTestActionAudit(db, {
          eventId: event.eventId,
          testActorUserId: input.primaryManagerUserId,
          actualAdminUserId: input.actualAdminUserId!,
          action: "QUALITY_PRIMARY_APPROVED",
          requestId,
          occurredAt,
        });
        enqueueQualityActionNotifications(db, {
          eventId: event.eventId, eventNo: event.eventNo, action: "PRIMARY_APPROVED", actionId: requestId,
          context: { qualitySpecialistUserIds: event.isTest ? testQualitySpecialistUserIds() : listQualitySpecialistUserIds() }, subject: "质量事件待终验",
          summary: `${event.title}；原主责已完成全链路验收`, occurredAt,
        });
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      return getEvent(event.eventId);
    }
    if (!reason) throw new Error("退回原因必填");
    const returnedNodeId = String(input.returnedNodeId ?? "").trim();
    if (!returnedNodeId || returnedNodeId === primary.nodeId) throw new Error("必须选择具体下级分支");
    const target = getNode(returnedNodeId);
    if (target.eventId !== event.eventId) throw new Error("退回节点不属于当前质量事件");
    const lineage = (db.prepare(`
      WITH RECURSIVE parents AS (
        SELECT * FROM quality_assignment_nodes WHERE node_id = ?
        UNION ALL SELECT p.* FROM quality_assignment_nodes p JOIN parents c ON c.parent_node_id = p.node_id
      ) SELECT * FROM parents
    `).all(target.nodeId) as DatabaseRow[]);
    if (!lineage.some((row) => String(row.node_id) === primary.nodeId)) throw new Error("退回节点不在原主责链路中");
    const nextStatus = transitionQualityEvent(event.status, "PRIMARY_RETURN");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE quality_assignment_nodes SET status='RETURNED',version=version+1,updated_at=? WHERE node_id=?")
        .run(occurredAt, target.nodeId);
      for (const ancestor of lineage.filter((row) => String(row.node_id) !== target.nodeId)) {
        db.prepare("UPDATE quality_assignment_nodes SET status='IN_PROGRESS',version=version+1,updated_at=? WHERE node_id=?")
          .run(occurredAt, String(ancestor.node_id));
      }
      db.prepare(`INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at) VALUES (?,?,?,?, 'RETURN',?,?,?,?)`)
        .run(id(), event.eventId, target.nodeId, input.primaryManagerUserId, reason, evidenceVersion(target.nodeId), requestId, occurredAt);
      const updated = db.prepare("UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(nextStatus, occurredAt, event.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES (?,?,?,'department_manager','QUALITY_PRIMARY_RETURNED_BRANCH',?,?,?,?,?)`)
        .run(id(), event.eventId, input.primaryManagerUserId, JSON.stringify({ status: event.status }), JSON.stringify({ status: nextStatus, returnedNodeId }), reason, requestId, occurredAt);
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.primaryManagerUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_PRIMARY_RETURNED_BRANCH",
        requestId,
        occurredAt,
      });
      enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "QUALITY_RETURNED", actionId: requestId,
        context: { aftersalesManagerUserId: event.createdBy, primaryManagerUserId: primary.assigneeUserId, returnedAssigneeUserId: target.assigneeUserId },
        subject: "质量事件分支被退回", summary: `${event.title}；退回原因：${reason}`, occurredAt,
      });
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    for (const row of lineage) {
      const reopened = getNode(String(row.node_id));
      reopenFormalTask(reopened, `原主责退回分支：${reason}`);
    }
    return getEvent(event.eventId);
  }

  return { reviewDirectChild, primaryReview, getNode, getEvent, close: () => db.close() };
}
