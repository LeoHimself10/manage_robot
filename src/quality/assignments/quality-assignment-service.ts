import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { formatDueAtForStorage } from "../../agent/reminders/due-at-parse";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { listQualitySpecialistUserIds, resolveQualityCapabilities } from "../../security/quality-capabilities";
import { listWorkbenchManagerIds } from "../../security/workbench-manager-whitelist";
import type {
  QualityAssignmentNode,
  QualityEventRecord,
  QualityTaskLink,
} from "../domain/quality-types";
import { createQualityStore } from "../infra/quality-store";
import { createQualityTaskBridge } from "./quality-task-bridge";
import { enqueueQualityActionNotifications } from "../notifications/quality-notification-policy";
import {
  assertChildDueWithinParent,
  assertNoAncestorAssignee,
} from "./quality-assignment-policy";
import { createQualitySupervisorDirectory } from "./quality-supervisor-directory";
import {
  appendQualityTestActionAudit,
  assertQualityActorBoundary,
  testQualitySpecialistUserIds,
} from "../testing/quality-test-boundary";

type DatabaseRow = Record<string, unknown>;

function requestId(value: string): string {
  return z.string().uuid().parse(value);
}

function deterministicNodeId(eventId: string, value: string): string {
  return `qn:${createHash("sha256").update(`${eventId}|${value}`).digest("hex").slice(0, 32)}`;
}

function normalizeDueAt(value: string): string {
  const normalized = formatDueAtForStorage(value);
  if (!normalized || !Number.isFinite(Date.parse(normalized))) throw new Error("质量任务期限无效");
  return normalized;
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface QualityNodeActionInput {
  nodeId: string;
  actorUserId: string;
  actualAdminUserId?: string;
  expectedVersion: number;
  requestId: string;
}

export function createQualityAssignmentService(deps?: {
  dbPath?: string;
  now?: () => string;
  id?: () => string;
  managerIds?: () => Set<string>;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 8000");
  let formalStore: ReturnType<typeof createWorkbenchFormalTaskStore> | null = null;
  function getFormalStore() {
    formalStore ??= createWorkbenchFormalTaskStore();
    return formalStore;
  }
  function getBridge() {
    return createQualityTaskBridge(getFormalStore());
  }
  const people = createPeopleDirectoryStore(dbPath);
  const supervisors = createQualitySupervisorDirectory({ dbPath });
  const now = deps?.now ?? (() => new Date().toISOString());
  const id = deps?.id ?? randomUUID;
  const managerIds = deps?.managerIds ?? listWorkbenchManagerIds;

  function qualityStore() {
    return createQualityStore(dbPath);
  }

  function getEvent(eventId: string): QualityEventRecord {
    const store = qualityStore();
    try {
      const event = store.getEvent(eventId);
      if (!event) throw new Error("质量事件不存在");
      return event;
    } finally {
      store.close();
    }
  }

  function getNode(nodeId: string): QualityAssignmentNode {
    const store = qualityStore();
    try {
      const node = store.getAssignmentNode(nodeId);
      if (!node) throw new Error("质量分配节点不存在");
      return node;
    } finally {
      store.close();
    }
  }

  function getTaskLink(nodeId: string): QualityTaskLink {
    const store = qualityStore();
    try {
      const link = store.getTaskLinkByNodeId(nodeId);
      if (!link) throw new Error("质量正式任务桥接不存在");
      return link;
    } finally {
      store.close();
    }
  }

  function getSubtaskLink(nodeId: string): QualityTaskLink & { subtaskId: string } {
    const link = getTaskLink(nodeId);
    if (!link.subtaskId) throw new Error("该质量根节点只关联父任务，请在原任务系统处理");
    return link as QualityTaskLink & { subtaskId: string };
  }

  function appendAudit(input: {
    eventId: string;
    actorUserId: string;
    actorRole: string;
    action: string;
    before: unknown;
    after: unknown;
    reason?: string;
    requestId: string;
    occurredAt: string;
  }): void {
    db.prepare(`
      INSERT INTO quality_audit_events (
        id, event_id, actor_user_id, actor_role, action,
        before_json, after_json, reason, request_id, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id(),
      input.eventId,
      input.actorUserId,
      input.actorRole,
      input.action,
      input.before == null ? null : JSON.stringify(input.before),
      input.after == null ? null : JSON.stringify(input.after),
      input.reason ?? null,
      input.requestId,
      input.occurredAt,
    );
  }

  function requireSpecialist(userId: string): void {
    if (!resolveQualityCapabilities(userId).hasQualityManagement) {
      throw new Error("仅具备质量管理能力的人员可执行该操作");
    }
  }

  function requireManager(userId: string): void {
    if (!managerIds().has(userId)) throw new Error("目标人员不在主管名单中");
  }

  function validateDelegateTarget(userId: string, kind: "MANAGER" | "EMPLOYEE"): void {
    if (kind === "MANAGER") {
      requireManager(userId);
      return;
    }
    const contact = people.getContact(userId);
    if (!contact?.active || contact.deletedAt) throw new Error("目标员工不在有效通讯录中");
    if (people.getExternalAccountByUserId(userId)?.enabled) {
      throw new Error("外部密码账号不能承接质量任务");
    }
  }

  function existingNodeForRequest(eventId: string, reqId: string): QualityAssignmentNode | null {
    const row = db.prepare(`
      SELECT node_id FROM quality_assignment_nodes WHERE event_id = ? AND request_id = ?
    `).get(eventId, reqId) as DatabaseRow | undefined;
    return row ? getNode(String(row.node_id)) : null;
  }

  function resultForNode(nodeId: string) {
    const node = getNode(nodeId);
    const event = getEvent(node.eventId);
    return { event, node, taskLink: event.isTest ? null : getTaskLink(nodeId) };
  }

  async function assignPrimary(input: {
    eventId: string;
    specialistUserId: string;
    primaryManagerUserId: string;
    departmentName?: string;
    actualAdminUserId?: string;
    dueAt: string;
    taskRequirement: string;
    expectedVersion: number;
    requestId: string;
  }) {
    const event = getEvent(input.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.specialistUserId });
    const departmentName = String(input.departmentName ?? "").trim();
    if (event.isTest) {
      if (!testQualitySpecialistUserIds().includes(input.specialistUserId)) {
        throw new Error("只有佟成（测试）可以选择测试主管");
      }
      if (!input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
      if (!supervisors.resolveEligibleUser({
        eventId: event.eventId,
        isTest: true,
        userId: input.primaryManagerUserId,
        departmentName,
      })) throw new Error("测试主管候选无效");
    } else {
      requireSpecialist(input.specialistUserId);
      if (departmentName) {
        if (!supervisors.resolveEligibleUser({
          eventId: event.eventId,
          isTest: false,
          userId: input.primaryManagerUserId,
          departmentName,
        })) throw new Error("主管候选已失效，请重新选择");
      } else {
        requireManager(input.primaryManagerUserId);
      }
    }
    const reqId = requestId(input.requestId);
    const requirement = input.taskRequirement.trim();
    if (!requirement) throw new Error("质量任务要求必填");
    const dueAt = normalizeDueAt(input.dueAt);
    const repeated = existingNodeForRequest(input.eventId, reqId);
    if (repeated) {
      if (repeated.assigneeUserId !== input.primaryManagerUserId || repeated.dueAt !== dueAt) {
        throw new Error("质量分配请求冲突");
      }
      return resultForNode(repeated.nodeId);
    }
    if (event.status !== "PENDING_ASSIGNMENT") throw new Error("质量事件当前不可分配");
    if (event.version !== input.expectedVersion) throw new Error("version conflict");
    const nodeId = deterministicNodeId(input.eventId, reqId);
    const formal = event.isTest ? null : getBridge().createNodeTask({
      nodeId,
      eventNo: event.eventNo,
      eventTitle: event.title,
      eventSummary: event.problemStatus,
      requirement,
      initiatorUserId: input.specialistUserId,
      managerUserId: input.specialistUserId,
      assigneeUserId: input.primaryManagerUserId,
      dueAt,
      requestId: reqId,
    });
    const occurredAt = now();
    transaction(db, () => {
      db.prepare(`
        INSERT INTO quality_assignment_nodes (
          node_id, event_id, parent_node_id, depth, assignee_user_id, assignee_kind,
          department_name, is_primary, status, due_at, requirement, version,
          created_by, request_id, accepted_at, submitted_at, created_at, updated_at
        ) VALUES (?, ?, NULL, 0, ?, 'MANAGER', ?, 0, 'PENDING_ACCEPTANCE', ?, ?, 1, ?, ?, NULL, NULL, ?, ?)
      `).run(
        nodeId,
        input.eventId,
        input.primaryManagerUserId,
        departmentName,
        dueAt,
        requirement,
        input.specialistUserId,
        reqId,
        occurredAt,
        occurredAt,
      );
      if (formal) {
        db.prepare(`
          INSERT INTO quality_task_links(node_id, task_id, subtask_id, integration_key, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(nodeId, formal.task.taskId, formal.subtask.subtaskId, formal.integrationKey, occurredAt);
      }
      const updated = db.prepare(`
        UPDATE quality_events SET status = 'PENDING_ACCEPTANCE', overall_due_at = ?,
          version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'PENDING_ASSIGNMENT' AND version = ?
      `).run(dueAt, occurredAt, input.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      appendAudit({
        eventId: input.eventId,
        actorUserId: input.specialistUserId,
        actorRole: "quality_specialist",
        action: "PRIMARY_ASSIGNED",
        before: event,
        after: { nodeId, primaryManagerUserId: input.primaryManagerUserId, dueAt, requirement },
        requestId: reqId,
        occurredAt,
      });
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.specialistUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "PRIMARY_ASSIGNED",
        requestId: reqId,
        occurredAt,
      });
      enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "PRIMARY_ASSIGNED", actionId: reqId,
        context: { primaryManagerUserId: input.primaryManagerUserId }, subject: "有新的质量任务待承接",
        summary: `${event.title}；任务要求：${requirement}`, occurredAt,
      });
    });
    return resultForNode(nodeId);
  }

  async function assignSupervisor(input: {
    eventId: string;
    specialistUserId: string;
    actualAdminUserId?: string;
    candidateRef: string;
    dueAt: string;
    taskRequirement: string;
    expectedVersion: number;
    requestId: string;
  }) {
    const event = getEvent(input.eventId);
    const candidate = supervisors.resolveCandidate({
      eventId: event.eventId,
      isTest: event.isTest,
      candidateRef: input.candidateRef,
    });
    if (!candidate) throw new Error("主管候选已失效，请重新选择");
    return assignPrimary({
      eventId: input.eventId,
      specialistUserId: input.specialistUserId,
      actualAdminUserId: input.actualAdminUserId,
      primaryManagerUserId: candidate.userId,
      departmentName: candidate.departmentName,
      dueAt: input.dueAt,
      taskRequirement: input.taskRequirement,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
    });
  }

  async function acceptNode(input: QualityNodeActionInput) {
    const reqId = requestId(input.requestId);
    const node = getNode(input.nodeId);
    const event = getEvent(node.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.actorUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (node.assigneeUserId !== input.actorUserId) throw new Error("只有节点承接人可以承接");
    if (node.status === "IN_PROGRESS") return resultForNode(node.nodeId);
    if (node.status !== "PENDING_ACCEPTANCE") throw new Error("质量节点当前不可承接");
    if (node.version !== input.expectedVersion) throw new Error("version conflict");
    if (node.parentNodeId == null && event.primaryNodeId && event.primaryNodeId !== node.nodeId) {
      throw new Error("原主责承接人不可替换");
    }
    if (!event.isTest) {
      const link = getSubtaskLink(node.nodeId);
      getFormalStore().updateSubtaskStatus({
        subtaskId: link.subtaskId,
        actorUserId: input.actorUserId,
        action: "accept",
        note: "已承接质量任务",
      });
    }
    const occurredAt = now();
    transaction(db, () => {
      const updatedNode = db.prepare(`
        UPDATE quality_assignment_nodes SET status = 'IN_PROGRESS', accepted_at = ?,
          is_primary = CASE WHEN parent_node_id IS NULL THEN 1 ELSE is_primary END,
          version = version + 1, updated_at = ?
        WHERE node_id = ? AND status = 'PENDING_ACCEPTANCE' AND version = ?
      `).run(occurredAt, occurredAt, node.nodeId, input.expectedVersion);
      if (Number(updatedNode.changes) !== 1) throw new Error("version conflict");
      if (node.parentNodeId == null) {
        const updatedEvent = db.prepare(`
          UPDATE quality_events SET status = 'IN_PROGRESS',
            primary_node_id = COALESCE(primary_node_id, ?),
            original_primary_department_id = COALESCE(original_primary_department_id, ?),
            version = version + 1, updated_at = ?
          WHERE id = ? AND version = ? AND (primary_node_id IS NULL OR primary_node_id = ?)
        `).run(node.nodeId, node.departmentName || null, occurredAt, event.eventId, event.version, node.nodeId);
        if (Number(updatedEvent.changes) !== 1) throw new Error("version conflict");
      } else if (event.status === "PENDING_ACCEPTANCE") {
        db.prepare(`
          UPDATE quality_events SET status='IN_PROGRESS',version=version+1,updated_at=?
          WHERE id=? AND status='PENDING_ACCEPTANCE'
        `).run(occurredAt, event.eventId);
      }
      appendAudit({
        eventId: node.eventId,
        actorUserId: input.actorUserId,
        actorRole: node.assigneeKind === "MANAGER" ? "department_manager" : "executor",
        action: "QUALITY_NODE_ACCEPTED",
        before: node,
        after: { status: "IN_PROGRESS" },
        requestId: reqId,
        occurredAt,
      });
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_NODE_ACCEPTED",
        requestId: reqId,
        occurredAt,
      });
    });
    return resultForNode(node.nodeId);
  }

  async function rejectNode(input: QualityNodeActionInput & { reason: string }) {
    const reqId = requestId(input.requestId);
    const reason = input.reason.trim();
    if (!reason) throw new Error("驳回原因必填");
    const node = getNode(input.nodeId);
    const event = getEvent(node.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.actorUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (node.assigneeUserId !== input.actorUserId) throw new Error("只有节点承接人可以驳回");
    if (node.status === "REJECTED") return resultForNode(node.nodeId);
    if (node.status !== "PENDING_ACCEPTANCE") throw new Error("质量节点当前不可驳回");
    if (node.version !== input.expectedVersion) throw new Error("version conflict");
    if (!event.isTest) {
      const link = getSubtaskLink(node.nodeId);
      getFormalStore().updateSubtaskStatus({
        subtaskId: link.subtaskId,
        actorUserId: input.actorUserId,
        action: "reject",
        note: reason,
      });
    }
    const occurredAt = now();
    transaction(db, () => {
      const updated = db.prepare(`
        UPDATE quality_assignment_nodes SET status = 'REJECTED', version = version + 1,
          updated_at = ? WHERE node_id = ? AND status = 'PENDING_ACCEPTANCE' AND version = ?
      `).run(occurredAt, node.nodeId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      if (node.parentNodeId == null) {
        const eventUpdated = db.prepare(`
          UPDATE quality_events SET status = 'PENDING_ASSIGNMENT', version = version + 1,
            updated_at = ? WHERE id = ? AND version = ?
        `).run(occurredAt, event.eventId, event.version);
        if (Number(eventUpdated.changes) !== 1) throw new Error("version conflict");
      }
      appendAudit({
        eventId: node.eventId,
        actorUserId: input.actorUserId,
        actorRole: node.assigneeKind === "MANAGER" ? "department_manager" : "executor",
        action: "QUALITY_NODE_REJECTED",
        before: node,
        after: { status: "REJECTED" },
        reason,
        requestId: reqId,
        occurredAt,
      });
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_NODE_REJECTED",
        requestId: reqId,
        occurredAt,
      });
      const parentUserId = node.parentNodeId ? getNode(node.parentNodeId).assigneeUserId : null;
      const primaryUserId = event.primaryNodeId ? getNode(event.primaryNodeId).assigneeUserId : null;
      enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "NODE_REJECTED", actionId: reqId,
        context: { directParentUserId: parentUserId, primaryManagerUserId: primaryUserId, qualitySpecialistUserIds: event.isTest ? testQualitySpecialistUserIds() : listQualitySpecialistUserIds() },
        subject: "质量任务被驳回", summary: `${event.title}；驳回原因：${reason}`, occurredAt,
      });
    });
    return resultForNode(node.nodeId);
  }

  async function delegateNode(input: {
    parentNodeId: string;
    actorUserId: string;
    assigneeUserId: string;
    assigneeKind: "MANAGER" | "EMPLOYEE";
    departmentName: string;
    dueAt: string;
    requirement: string;
    expectedVersion: number;
    requestId: string;
    actualAdminUserId?: string;
  }) {
    const reqId = requestId(input.requestId);
    const parent = getNode(input.parentNodeId);
    const event = getEvent(parent.eventId);
    assertQualityActorBoundary({ event, actorUserId: input.actorUserId });
    if (event.isTest && !input.actualAdminUserId) throw new Error("测试操作缺少实际管理员审计信息");
    if (parent.assigneeUserId !== input.actorUserId) throw new Error("只能操作自己承接的质量节点");
    if (parent.assigneeKind !== "MANAGER" || parent.status !== "IN_PROGRESS") {
      throw new Error("只有处理中的主管节点可以继续分配");
    }
    if (parent.version !== input.expectedVersion) throw new Error("version conflict");
    if (input.assigneeKind !== "EMPLOYEE") throw new Error("质量主管只能继续分配给本部门员工");
    supervisors.assertDepartmentEmployee({
      eventIsTest: event.isTest,
      managerDepartmentName: parent.departmentName,
      employeeUserId: input.assigneeUserId,
    });
    if (!event.isTest) validateDelegateTarget(input.assigneeUserId, input.assigneeKind);
    if (input.departmentName.trim() !== parent.departmentName.trim()) {
      throw new Error("主管只能向自己部门的员工分配");
    }
    const store = qualityStore();
    let ancestors: QualityAssignmentNode[];
    try { ancestors = store.listAncestors(parent.nodeId); } finally { store.close(); }
    assertNoAncestorAssignee({ parent, ancestors, assigneeUserId: input.assigneeUserId });
    const dueAt = normalizeDueAt(input.dueAt);
    assertChildDueWithinParent(dueAt, parent.dueAt);
    const requirement = input.requirement.trim();
    if (!requirement) throw new Error("子节点要求必填");
    const repeated = existingNodeForRequest(parent.eventId, reqId);
    if (repeated) return resultForNode(repeated.nodeId);
    const nodeId = deterministicNodeId(event.eventId, reqId);
    const formal = event.isTest ? null : getBridge().createNodeTask({
      nodeId,
      eventNo: event.eventNo,
      eventTitle: event.title,
      eventSummary: event.problemStatus,
      requirement,
      initiatorUserId: input.actorUserId,
      managerUserId: input.actorUserId,
      assigneeUserId: input.assigneeUserId,
      dueAt,
      requestId: reqId,
      parentAssigneeUserId: parent.assigneeUserId,
    });
    const occurredAt = now();
    transaction(db, () => {
      db.prepare(`
        INSERT INTO quality_assignment_nodes (
          node_id, event_id, parent_node_id, depth, assignee_user_id, assignee_kind,
          department_name, is_primary, status, due_at, requirement, version,
          created_by, request_id, accepted_at, submitted_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'PENDING_ACCEPTANCE', ?, ?, 1, ?, ?, NULL, NULL, ?, ?)
      `).run(
        nodeId,
        event.eventId,
        parent.nodeId,
        parent.depth + 1,
        input.assigneeUserId,
        input.assigneeKind,
        input.departmentName.trim(),
        dueAt,
        requirement,
        input.actorUserId,
        reqId,
        occurredAt,
        occurredAt,
      );
      if (formal) {
        db.prepare(`
          INSERT INTO quality_task_links(node_id, task_id, subtask_id, integration_key, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(nodeId, formal.task.taskId, formal.subtask.subtaskId, formal.integrationKey, occurredAt);
      }
      const parentUpdated = db.prepare(`
        UPDATE quality_assignment_nodes SET version = version + 1, updated_at = ?
        WHERE node_id = ? AND version = ? AND status = 'IN_PROGRESS'
      `).run(occurredAt, parent.nodeId, input.expectedVersion);
      if (Number(parentUpdated.changes) !== 1) throw new Error("version conflict");
      appendAudit({
        eventId: event.eventId,
        actorUserId: input.actorUserId,
        actorRole: "department_manager",
        action: "QUALITY_NODE_DELEGATED",
        before: parent,
        after: { nodeId, assigneeUserId: input.assigneeUserId, assigneeKind: input.assigneeKind, dueAt },
        requestId: reqId,
        occurredAt,
      });
      if (event.isTest) appendQualityTestActionAudit(db, {
        eventId: event.eventId,
        testActorUserId: input.actorUserId,
        actualAdminUserId: input.actualAdminUserId!,
        action: "QUALITY_NODE_DELEGATED",
        requestId: reqId,
        occurredAt,
      });
      enqueueQualityActionNotifications(db, {
        eventId: event.eventId, eventNo: event.eventNo, action: "NODE_DELEGATED", actionId: reqId,
        context: { directAssigneeUserId: input.assigneeUserId }, subject: "有新的质量协同任务待承接",
        summary: `${event.title}；任务要求：${requirement}`, occurredAt,
      });
    });
    return resultForNode(nodeId);
  }

  async function changeDirectChildDueAt(input: {
    childNodeId: string;
    actorUserId: string;
    dueAt: string;
    reason: string;
    expectedVersion: number;
    requestId: string;
  }) {
    const reqId = requestId(input.requestId);
    const reason = input.reason.trim();
    if (!reason) throw new Error("改期原因必填");
    const child = getNode(input.childNodeId);
    if (!child.parentNodeId) throw new Error("根节点期限由质量专员管理");
    const parent = getNode(child.parentNodeId);
    if (parent.assigneeUserId !== input.actorUserId) throw new Error("只能修改直接子节点期限");
    if (child.version !== input.expectedVersion) throw new Error("version conflict");
    const dueAt = normalizeDueAt(input.dueAt);
    assertChildDueWithinParent(dueAt, parent.dueAt);
    const link = getSubtaskLink(child.nodeId);
    getFormalStore().setSubtaskDueAt({
      subtaskId: link.subtaskId,
      actorUserId: input.actorUserId,
      dueAt,
      dueSetBy: "manager",
      note: reason,
    });
    const occurredAt = now();
    transaction(db, () => {
      const updated = db.prepare(`
        UPDATE quality_assignment_nodes SET due_at = ?, version = version + 1, updated_at = ?
        WHERE node_id = ? AND version = ?
      `).run(dueAt, occurredAt, child.nodeId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      appendAudit({
        eventId: child.eventId,
        actorUserId: input.actorUserId,
        actorRole: "department_manager",
        action: "QUALITY_CHILD_DUE_CHANGED",
        before: { dueAt: child.dueAt },
        after: { dueAt },
        reason,
        requestId: reqId,
        occurredAt,
      });
    });
    return resultForNode(child.nodeId);
  }

  async function changeEventDueAt(input: {
    eventId: string;
    specialistUserId: string;
    dueAt: string;
    reason: string;
    expectedVersion: number;
    requestId: string;
  }): Promise<QualityEventRecord> {
    requireSpecialist(input.specialistUserId);
    const reqId = requestId(input.requestId);
    const reason = input.reason.trim();
    if (!reason) throw new Error("改期原因必填");
    const event = getEvent(input.eventId);
    if (event.version !== input.expectedVersion) throw new Error("version conflict");
    const dueAt = normalizeDueAt(input.dueAt);
    const rootRow = db.prepare(`
      SELECT node_id FROM quality_assignment_nodes
      WHERE event_id = ? AND parent_node_id IS NULL AND status NOT IN ('REJECTED','CANCELLED')
      ORDER BY created_at DESC LIMIT 1
    `).get(input.eventId) as DatabaseRow | undefined;
    if (!rootRow) throw new Error("原主责节点不存在");
    const root = getNode(String(rootRow.node_id));
    const link = getSubtaskLink(root.nodeId);
    getFormalStore().setSubtaskDueAt({
      subtaskId: link.subtaskId,
      actorUserId: input.specialistUserId,
      dueAt,
      dueSetBy: "manager",
      note: reason,
    });
    const occurredAt = now();
    transaction(db, () => {
      const updated = db.prepare(`
        UPDATE quality_events SET overall_due_at = ?, version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?
      `).run(dueAt, occurredAt, event.eventId, input.expectedVersion);
      if (Number(updated.changes) !== 1) throw new Error("version conflict");
      db.prepare(`
        UPDATE quality_assignment_nodes SET due_at = ?, version = version + 1, updated_at = ?
        WHERE node_id = ?
      `).run(dueAt, occurredAt, root.nodeId);
      appendAudit({
        eventId: event.eventId,
        actorUserId: input.specialistUserId,
        actorRole: "quality_specialist",
        action: "QUALITY_EVENT_DUE_CHANGED",
        before: { dueAt: event.overallDueAt },
        after: { dueAt },
        reason,
        requestId: reqId,
        occurredAt,
      });
    });
    return getEvent(event.eventId);
  }

  function appendPublicNodeNote(input: {
    nodeId: string;
    actorUserId: string;
    kind: "request_changes" | "customize";
    note: string;
    requestId: string;
  }): void {
    const reqId = requestId(input.requestId);
    const note = input.note.trim();
    if (!note) throw new Error("公开说明不能为空");
    const node = getNode(input.nodeId);
    if (node.assigneeUserId !== input.actorUserId) throw new Error("只能记录自己的质量节点说明");
    if (db.prepare("SELECT 1 FROM quality_audit_events WHERE request_id = ? LIMIT 1").get(reqId)) return;
    const occurredAt = now();
    transaction(db, () => appendAudit({
      eventId: node.eventId,
      actorUserId: input.actorUserId,
      actorRole: node.assigneeKind === "MANAGER" ? "department_manager" : "executor",
      action: "QUALITY_NODE_PUBLIC_NOTE",
      before: null,
      after: { nodeId: node.nodeId, kind: input.kind, note },
      reason: note,
      requestId: reqId,
      occurredAt,
    }));
  }

  return {
    assignPrimary,
    assignSupervisor,
    acceptNode,
    rejectNode,
    delegateNode,
    changeDirectChildDueAt,
    changeEventDueAt,
    appendPublicNodeNote,
    getNode,
    getEvent,
    getTaskLink,
    close() {
      supervisors.close();
      people.close();
      db.close();
    },
  };
}
