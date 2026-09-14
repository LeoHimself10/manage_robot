import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { resolveQualityCapabilities } from "../../security/quality-capabilities";
import { computeQualityReturnImpact, transitionQualityEvent } from "../domain/quality-state-machine";
import type { QualityAssignmentNode, QualityEventRecord } from "../domain/quality-types";
import { assignmentNodeFromRow, eventFromRow, createQualityStore } from "../infra/quality-store";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  testQualitySpecialistUserIds,
} from "../testing/quality-test-boundary";

import { ensureQualityFinalCommentSchema, enqueueQualityFinalComment, qualityFinalComments } from "../oa/quality-final-comment";
import { readQualityEmployeeWork } from "../evidence/quality-employee-work";

type DatabaseRow = Record<string, unknown>;

export function createQualityClosureService(deps?: { dbPath?: string; now?: () => string; id?: () => string }) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON"); db.exec("PRAGMA busy_timeout = 8000");
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;
  ensureQualityFinalCommentSchema(db);
  const formalStore = createWorkbenchFormalTaskStore({ dbPath, database: db });

  function requireSpecialist(userId: string): void {
    if (!resolveQualityCapabilities(userId).hasQualityManagement) {
      throw new Error("仅具备质量管理能力的员工可执行终验、关闭或重开");
    }
  }
  function requireSpecialistForEvent(
    event: QualityEventRecord,
    userId: string,
    actualAdminUserId?: string,
  ): void {
    assertQualityActorBoundary({ event, actorUserId: userId });
    if (!event.isTest) {
      requireSpecialist(userId);
      return;
    }
    if (!testQualitySpecialistUserIds().includes(userId)) {
      throw new Error("只有佟成（测试）可以处理测试终验");
    }
    if (!actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
  }
  function getEvent(eventId: string): QualityEventRecord {
    const row = db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL").get(eventId) as DatabaseRow | undefined;
    if (!row) throw new Error("质量事件不存在");
    return eventFromRow(row);
  }
  function getNode(nodeId: string): QualityAssignmentNode {
    const row = db.prepare("SELECT * FROM quality_assignment_nodes WHERE node_id=?").get(nodeId) as DatabaseRow | undefined;
    if (!row) throw new Error("质量节点不存在");
    return assignmentNodeFromRow(row);
  }
  function repeated(requestId: string, eventId: string, actor: string, action: string, reason: string, nodeId?: string) {
    const row = db.prepare("SELECT * FROM quality_audit_events WHERE request_id=? AND action NOT LIKE 'QUALITY_TEST_%' LIMIT 1").get(requestId) as DatabaseRow | undefined;
    if (!row) return false;
    const after = JSON.parse(String(row.after_json ?? '{}'));
    if (row.event_id !== eventId || row.actor_user_id !== actor || row.action !== action || String(row.reason ?? '') !== reason || (nodeId && after.returnedNodeId !== nodeId)) throw new Error("requestId conflict");
    return true;
  }
  function evidenceVersion(nodeId: string): number | null {
    const row = db.prepare("SELECT MAX(evidence_version) AS version FROM quality_evidence WHERE node_id = ?").get(nodeId) as DatabaseRow;
    return row.version == null ? null : Number(row.version);
  }
  function reopenFormal(nodeId: string, reason: string): void {
    const node = getNode(nodeId);
    const link = db.prepare("SELECT subtask_id FROM quality_task_links WHERE node_id = ?").get(nodeId) as DatabaseRow | undefined;
    if (!link || link.subtask_id == null) return;
    formalStore.updateSubtaskStatus({ subtaskId: String(link.subtask_id), actorUserId: node.assigneeUserId, action: "progress", progressStatus: "IN_PROGRESS", note: reason });
  }
  function nodesForEvent(eventId: string) {
    return (db.prepare(`SELECT node_id,parent_node_id,status,event_id FROM quality_assignment_nodes WHERE event_id = ? AND status NOT IN ('CANCELLED','REJECTED')`).all(eventId) as DatabaseRow[])
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
    actualAdminUserId?: string;
  }) {
    const requestId = z.string().uuid().parse(input.requestId);
    const target = getNode(input.nodeId);
    if (target.eventId !== input.event.eventId) throw new Error("指定节点不属于当前质量事件");
    if (input.event.version !== input.expectedVersion) throw new Error("version conflict");
    const reason = input.reason.trim();
    if (!reason || reason.length > 2000) throw new Error(input.action === "QUALITY_REOPEN" ? "重开原因必填" : "退回原因必填");
    if (!["APPROVED", "PENDING_PARENT_REVIEW"].includes(target.status)) throw new Error("当前节点不能退回");
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
      if (input.event.isTest) appendQualityTestActionAudit(db, {
        eventId: input.event.eventId,
        testActorUserId: input.specialistUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: auditAction,
        requestId,
        occurredAt,
      });
      const primary = input.event.primaryNodeId ? getNode(input.event.primaryNodeId) : null;
      enqueueQualityActionNotifications(db, {
        eventId: input.event.eventId, eventNo: input.event.eventNo, action: "QUALITY_RETURNED", actionId: requestId,
        context: { aftersalesManagerUserId: input.event.createdBy, primaryManagerUserId: primary?.assigneeUserId, returnedAssigneeUserId: target.assigneeUserId },
        subject: input.action === "QUALITY_REOPEN" ? "质量事件已重开" : "质量事件被质量专员退回",
        summary: `${input.event.title}；原因：${reason}`, occurredAt,
      });
      for (const nodeId of impact.affectedNodeIds) reopenFormal(nodeId, reason);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return { event: getEvent(input.event.eventId), affectedNodeIds: impact.affectedNodeIds };
  }

  function returnSpecificNode(input: { eventId: string; nodeId: string; specialistUserId: string; actualAdminUserId?: string; reason: string; expectedVersion: number; requestId: string }) {
    const event = getEvent(input.eventId);
    requireSpecialistForEvent(event, input.specialistUserId, input.actualAdminUserId);
    z.string().uuid().parse(input.requestId);
    if (repeated(input.requestId,event.eventId,input.specialistUserId,"QUALITY_RETURNED_NODE",input.reason.trim(),input.nodeId)) return {event,affectedNodeIds:[]};
    if (event.status !== "PENDING_QUALITY_REVIEW") throw new Error("质量事件当前不可指定节点退回");
    return returnNode({ ...input, event, action: "QUALITY_RETURN_NODE" });
  }

  function closeEvent(input: { eventId: string; specialistUserId: string; actualAdminUserId?: string; conclusion: string; expectedVersion: number; requestId: string }): QualityEventRecord {
    const requestId = z.string().uuid().parse(input.requestId);
    const event = getEvent(input.eventId);
    requireSpecialistForEvent(event, input.specialistUserId, input.actualAdminUserId);
    if (repeated(requestId,event.eventId,input.specialistUserId,"QUALITY_CLOSED",input.conclusion.trim())) return event;
    if (event.status !== "PENDING_QUALITY_REVIEW") throw new Error("质量事件当前不可关闭");
    if (event.version !== input.expectedVersion) throw new Error("version conflict");
    const conclusion = input.conclusion.trim();
    if (!conclusion || conclusion.length > 900) throw new Error("关闭结论必填且不超过 900 字");
    const nodes = db.prepare("SELECT node_id,status FROM quality_assignment_nodes WHERE event_id=? AND status NOT IN ('REJECTED','CANCELLED')")
      .all(event.eventId) as DatabaseRow[];
    if (nodes.length === 0 || nodes.some((node) => String(node.status) !== "APPROVED")) throw new Error("全链节点尚未全部验收通过");
    const leafWithoutEvidence = db.prepare(`
      SELECT n.node_id FROM quality_assignment_nodes n
      WHERE n.event_id=? AND n.status='APPROVED'
        AND NOT EXISTS (SELECT 1 FROM quality_assignment_nodes c WHERE c.parent_node_id=n.node_id AND c.status NOT IN ('REJECTED','CANCELLED'))
        AND NOT EXISTS (SELECT 1 FROM quality_evidence e WHERE e.node_id=n.node_id AND e.removed_at IS NULL)
      LIMIT 1
    `).get(event.eventId);
    if (leafWithoutEvidence) throw new Error("有效叶子节点证据不完整");
    const nextStatus = transitionQualityEvent(event.status, "QUALITY_CLOSE");
    const occurredAt = now();
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const node of nodes) {
        const work = readQualityEmployeeWork(db,String(node.node_id));
        if (work && work.assigneeUserId !== getNode(String(node.node_id)).assigneeUserId) throw new Error("正式任务负责人已变化，请刷新");
        if (work && !work.files.some(f=>f.current && f.submittedAt)) throw new Error("必须提交的证据不完整");
        if (work && (work.formalStatus !== 'DONE' || work.nodeStatus !== 'APPROVED')) throw new Error("正式任务状态已变化，请刷新核对");
        if (work && work.requirements.some(r => !work.files.some(f => f.current && f.requirementId === r.id && f.submittedAt))) throw new Error("必须提交的证据不完整");
      }
      const updated = db.prepare("UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?")
        .run(nextStatus, occurredAt, event.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,before_json,after_json,reason,request_id,occurred_at) VALUES (?,?,?,'quality_specialist','QUALITY_CLOSED',?,?,?,?,?)`)
        .run(id(), event.eventId, input.specialistUserId, JSON.stringify({ status: event.status }), JSON.stringify({ status: nextStatus, conclusion, actualOperatorUserId: input.actualAdminUserId ?? input.specialistUserId }), conclusion, requestId, occurredAt);
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.specialistUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_CLOSED",
        requestId,
        occurredAt,
      });
      enqueueQualityFinalComment(db, { closureId: requestId, eventId: event.eventId, actorUserId: input.specialistUserId, opinion: conclusion, occurredAt, isTest: event.isTest });
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

  function reopenEvent(input: { eventId: string; nodeId: string; specialistUserId: string; actualAdminUserId?: string; reason: string; expectedVersion: number; requestId: string }) {
    const event = getEvent(input.eventId);
    requireSpecialistForEvent(event, input.specialistUserId, input.actualAdminUserId);
    z.string().uuid().parse(input.requestId);
    if (repeated(input.requestId,event.eventId,input.specialistUserId,"QUALITY_REOPENED",input.reason.trim(),input.nodeId)) return {event,affectedNodeIds:[]};
    if (event.status !== "CLOSED") throw new Error("仅已关闭质量事件可重开");
    return returnNode({ ...input, event, action: "QUALITY_REOPEN" });
  }

  function workspace(eventId: string, actorUserId: string) {
    const event = getEvent(eventId); requireSpecialistForEvent(event,actorUserId,process.env.QUALITY_PILOT_BUSINESS_USER_ID);
    const nodes = (db.prepare("SELECT * FROM quality_assignment_nodes WHERE event_id=? AND status NOT IN ('REJECTED','CANCELLED') ORDER BY depth,created_at").all(eventId) as DatabaseRow[]).map(row => {
      const node = assignmentNodeFromRow(row);
      return {...node,work:readQualityEmployeeWork(db,node.nodeId)};
    });
    const history = db.prepare("SELECT action,reason,after_json AS details,occurred_at AS occurredAt FROM quality_audit_events WHERE event_id=? AND action IN ('QUALITY_CLOSED','QUALITY_RETURNED_NODE','QUALITY_REOPENED','QUALITY_MANAGER_RETURN_HANDLED') ORDER BY occurred_at DESC").all(eventId);
    return {event,nodes,history,comments:qualityFinalComments(db,eventId),testMode:process.env.QUALITY_PILOT_TEST_MODE === '1' || event.isTest || process.env.QUALITY_OA_FINAL_COMMENT_ENABLED !== '1'};
  }

  /** A supervisor returned by quality decides what to supplement; approved siblings stay untouched. */
  function handleManagerReturn(input: {nodeId:string; actorUserId:string; expectedVersion:number; requestId:string; reason:string; childNodeId?:string; actualAdminUserId?:string}) {
    const requestId=z.string().uuid().parse(input.requestId), target=getNode(input.nodeId), event=getEvent(target.eventId);
    assertQualityActorBoundary({event,actorUserId:input.actorUserId});
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (target.assigneeKind !== 'MANAGER' || target.assigneeUserId !== input.actorUserId) throw new Error("仅被退回主管可处理");
    const reason=z.string().trim().min(1).max(2000).parse(input.reason), childId=input.childNodeId || '';
    const existing=db.prepare("SELECT * FROM quality_audit_events WHERE request_id=? AND action NOT LIKE 'QUALITY_TEST_%' LIMIT 1").get(requestId) as DatabaseRow|undefined;
    if(existing){const data=JSON.parse(String(existing.after_json));if(existing.action!=='QUALITY_MANAGER_RETURN_HANDLED'||existing.event_id!==event.eventId||existing.actor_user_id!==input.actorUserId||existing.reason!==reason||data.nodeId!==target.nodeId||data.childNodeId!==childId)throw new Error('requestId conflict');return event;}
    if(event.status!=='IN_PROGRESS'||target.status!=='RETURNED')throw new Error('当前没有待处理的主管退回');
    if(event.version!==input.expectedVersion)throw new Error('version conflict');
    const children=(db.prepare("SELECT * FROM quality_assignment_nodes WHERE parent_node_id=? AND status NOT IN ('REJECTED','CANCELLED')").all(target.nodeId) as DatabaseRow[]).map(assignmentNodeFromRow);
    const child=childId?children.find(n=>n.nodeId===childId):null;
    if(childId&&(!child||child.status!=='APPROVED'))throw new Error('请选择本人分支内已通过的员工任务');
    if(!childId&&(!children.length||children.some(n=>n.status!=='APPROVED')))throw new Error('下级任务尚未全部验收通过');
    const at=now();db.exec('BEGIN IMMEDIATE');
    try {
      if(child){
        const work=readQualityEmployeeWork(db,child.nodeId);
        if(work&&(work.managerUserId!==input.actorUserId||work.assigneeUserId!==child.assigneeUserId||work.formalStatus!=='DONE'))throw new Error('正式任务归属或状态已变化');
        db.prepare("UPDATE quality_assignment_nodes SET status='RETURNED',version=version+1,updated_at=? WHERE node_id=?").run(at,child.nodeId);
        db.prepare("INSERT INTO quality_node_reviews(review_id,event_id,node_id,reviewer_user_id,decision,reason,evidence_version,request_id,created_at) VALUES(?,?,?,?,'RETURN',?,?,?,?)").run(id(),event.eventId,child.nodeId,input.actorUserId,reason,evidenceVersion(child.nodeId),requestId,at);
        reopenFormal(child.nodeId,reason);
      }
      const nextNode=child?'IN_PROGRESS':target.isPrimary?'APPROVED':'PENDING_PARENT_REVIEW';
      db.prepare("UPDATE quality_assignment_nodes SET status=?,version=version+1,updated_at=? WHERE node_id=? AND status='RETURNED'").run(nextNode,at,target.nodeId);
      const status=!child&&target.isPrimary?'PENDING_QUALITY_REVIEW':'IN_PROGRESS';
      if(db.prepare("UPDATE quality_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=?").run(status,at,event.eventId,input.expectedVersion).changes!==1)throw new Error('version conflict');
      db.prepare("INSERT INTO quality_audit_events(id,event_id,actor_user_id,actor_role,action,after_json,reason,request_id,occurred_at) VALUES(?,?,?,'department_manager','QUALITY_MANAGER_RETURN_HANDLED',?,?,?,?)").run(id(),event.eventId,input.actorUserId,JSON.stringify({nodeId:target.nodeId,childNodeId:childId,status,actualOperatorUserId:input.actualAdminUserId??input.actorUserId}),reason,requestId,at);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return getEvent(event.eventId);
  }
  return { returnSpecificNode, closeEvent, reopenEvent, handleManagerReturn, workspace, getEvent, close: () => db.close() };
}
