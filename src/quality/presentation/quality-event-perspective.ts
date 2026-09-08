import { DatabaseSync } from "node:sqlite";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { HISTORICAL_FEEDBACK_TAXONOMY_V0 } from
  "../ai-original-assessment/historical-feedback-taxonomy-v0";
import {
  listQualityAftersalesManagerUserIds,
  resolveQualityCapabilities,
} from "../../security/quality-capabilities";
import { resolveWorkbenchCapabilities } from "../../security/workbench-capabilities";
import {
  getQualityTestActorByUserId,
  resolveQualityTestActor,
  type QualityPerspective,
  type QualityTestActor,
} from "../testing/quality-test-actors";
import {
  qualityActionLabel,
  qualityDecisionLabel,
  qualityNotificationLabel,
  qualityStatusLabel,
  qualityUrgencyLabel,
} from "./quality-display-labels";
import {
  listQualityFormalSubtasksFromDb,
  qualityEmployeeTaskStage,
  qualityFormalTaskStatusLabel,
  type QualityFormalSubtaskProjection,
} from "../analysis/quality-formal-task-projection";
import { getManagerQualityReviewContextsBySubtaskIds } from
  "../assignments/quality-task-context";
import {
  qualityManagerTaskStageBucket,
  qualityManagerTaskStageLabel,
  resolveQualityManagerTaskStageFromDb,
  type QualityManagerTaskStage,
} from "./quality-manager-task-stage";

type DatabaseRow = Record<string, unknown>;

export interface QualityPerspectiveRequest {
  viewerUserId: string;
  perspective?: QualityPerspective | null;
  testActorRef?: string | null;
}

export interface QualityPerspectiveContext {
  scope: "real" | "test";
  perspective: QualityPerspective;
  actorUserId: string;
  testActor: QualityTestActor | null;
  isAdmin: boolean;
  readonly: boolean;
}

export interface QualityEventSummaryViewModel {
  actionRef: string;
  eventNumber: string;
  title: string;
  /** Internal non-enumerable value used only before the HTTP response is serialized. */
  statusCode?: string;
  statusLabel: string;
  attentionBucket: "TODO" | "PROGRESS" | "DONE";
  attentionLabel: string;
  urgencyLabel: string;
  currentOwnerName: string;
  currentDepartmentName: string;
  updatedAt: string;
  testBadge: string | null;
  managerStages: QualityManagerTaskStage[];
  assignmentItems: QualityManagerAssignmentItemViewModel[];
  dispositionCode: "UNASSESSED" | "ORDINARY" | "QUALITY_ANOMALY" | null;
  dispositionLabel: string | null;
}

export interface QualityManagerAssignmentItemViewModel {
  actionRef: string;
  assigneeName: string;
  assignmentKind: "UNASSIGNED" | "REASSIGN_REQUIRED" | "MANAGER_ACTION_REQUIRED" | "ASSIGNED";
  previousAssigneeName: string | null;
  actionReason: string;
  itemTitle: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  statusLabel: string;
  managerStage: QualityManagerTaskStage;
  dueAt: string | null;
  progressNote: string;
  updatedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  submittedAt: string | null;
  reviewStatusLabel: string;
  reviewDecision: "APPROVE" | "RETURN" | null;
  reviewReason: string;
  reviewedAt: string | null;
  evidence: Array<{
    evidenceId: string;
    fileName: string;
    summary: string;
    uploaderName: string;
    createdAt: string;
  }>;
  taskNo: string | null;
  taskUrl: string | null;
  formalProjection: boolean;
}

export interface QualityProjectedEvidenceViewModel {
  evidenceId: string;
  nodeId: string;
  version: number;
  fileName: string;
  summary: string;
  mimeType: string;
  sizeBytes: number;
  uploaderName: string;
  createdAt: string;
  previewable: boolean;
  previewUrl: string;
  downloadUrl: string;
}

export interface QualityManagementAssignmentItemViewModel {
  actionRef: string;
  nodeId: string | null;
  parentNodeId: string | null;
  sourceTaskKey: string;
  assigneeName: string;
  itemTitle: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  statusLabel: string;
  nodeStatus: string | null;
  dueAt: string | null;
  dependsOn: string[];
  progressNote: string;
  updatedAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  reviewStatusLabel: string;
  reviewDecision: "APPROVE" | "RETURN" | null;
  reviewReason: string;
  reviewedAt: string | null;
  reviewedEvidenceVersion: number | null;
  evidence: QualityProjectedEvidenceViewModel[];
  taskNo: string;
  taskId: string;
  subtaskId: string;
  formalProjection: true;
}

const FACT_FIELDS: Array<{ label: string; keys: string[] }> = [
  { label: "反馈单号", keys: ["反馈单号", "feedbackNo"] },
  { label: "反馈时间", keys: ["反馈时间", "feedbackAt", "发生时间"] },
  { label: "反馈人", keys: ["反馈人", "reporter", "feedbackName"] },
  { label: "设备型号", keys: ["设备型号", "deviceModel"] },
  { label: "设备序列号", keys: ["设备序列号", "序列号", "serialNo", "deviceSerial"] },
  { label: "导管批次", keys: ["导管批次", "catheterBatch"] },
  { label: "问题分类", keys: ["问题分类", "category", "initialCategory"] },
  { label: "问题描述", keys: ["问题描述", "issueDescription", "problemStatus"] },
  { label: "术者感知", keys: ["术者是否感知", "术者是否可感知", "clinicianAware"] },
  { label: "影响说明", keys: ["影响", "impact"] },
  { label: "确认情况", keys: ["确认情况", "confirmation"] },
  { label: "解决方案", keys: ["解决方案", "solution"] },
  { label: "最终原因", keys: ["最终原因", "finalCause"] },
];

function nullable(value: unknown): string | null {
  const text = value == null ? "" : String(value).trim();
  return text || null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseStringArray(value: unknown): string[] {
  return [...new Set(parseArray(value)
    .map((item) => nullable(item))
    .filter((item): item is string => item != null))];
}

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function tableHasColumn(db: DatabaseSync, table: string, column: string): boolean {
  if (!tableExists(db, table)) return false;
  return (db.prepare(`PRAGMA table_info(${table})`).all() as DatabaseRow[])
    .some((item) => String(item.name) === column);
}

function stageKey(status: unknown): string {
  const keys: Record<string, string> = {
    DRAFT: "draft",
    PENDING_ANALYSIS: "pending-analysis",
    PENDING_ASSIGNMENT: "awaiting-supervisor",
    PENDING_ACCEPTANCE: "awaiting-acceptance",
    IN_PROGRESS: "in-progress",
    PENDING_PRIMARY_REVIEW: "manager-review",
    PENDING_QUALITY_REVIEW: "quality-review",
    CLOSED: "closed",
  };
  return keys[String(status ?? "")] ?? "unknown";
}

type QualityWorkspaceStage = "review" | "analysis" | "assignment" | "chain" | "final";

function qualityManagementDefaultStage(status: unknown): QualityWorkspaceStage {
  const stages: Record<string, QualityWorkspaceStage> = {
    DRAFT: "review",
    PENDING_ANALYSIS: "analysis",
    PENDING_ASSIGNMENT: "assignment",
    PENDING_ACCEPTANCE: "assignment",
    IN_PROGRESS: "chain",
    PENDING_PRIMARY_REVIEW: "chain",
    PENDING_QUALITY_REVIEW: "final",
    CLOSED: "final",
  };
  return stages[String(status ?? "")] ?? "review";
}

function safePerspective(value: unknown): QualityPerspective | null {
  const perspective = String(value ?? "");
  return ["aftersales", "quality_management", "manager", "employee", "dashboard"].includes(perspective)
    ? perspective as QualityPerspective
    : null;
}

export function resolveQualityPerspectiveContext(input: QualityPerspectiveRequest): QualityPerspectiveContext {
  const workbench = resolveWorkbenchCapabilities(input.viewerUserId);
  const isAdmin = workbench.primaryRole === "admin";
  const sessionTestActor = getQualityTestActorByUserId(input.viewerUserId);
  const testActor = resolveQualityTestActor(input.testActorRef) ?? sessionTestActor;
  if (testActor) {
    if (!isAdmin && sessionTestActor?.userId !== testActor.userId) {
      throw new Error("只有管理员可以切换其他质量测试视角");
    }
    return {
      scope: "test",
      perspective: testActor.perspective,
      actorUserId: testActor.userId,
      testActor,
      isAdmin,
      readonly: false,
    };
  }
  const requested = safePerspective(input.perspective);
  if (isAdmin) {
    const perspective = requested ?? "aftersales";
    const aftersales = listQualityAftersalesManagerUserIds()[0] ?? input.viewerUserId;
    return {
      scope: "real",
      perspective,
      actorUserId: perspective === "aftersales" ? aftersales : input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: true,
    };
  }
  const quality = resolveQualityCapabilities(input.viewerUserId);
  if (quality.roles.includes("aftersales_manager")) {
    return {
      scope: "real",
      perspective: "aftersales",
      actorUserId: input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: false,
    };
  }
  if (quality.hasQualityManagement) {
    return {
      scope: "real",
      perspective: "quality_management",
      actorUserId: input.viewerUserId,
      testActor: null,
      isAdmin,
      readonly: false,
    };
  }
  throw new Error("无质量业务访问权限");
}

export function createQualityEventPerspectiveProjector(
  dbPath = resolveWorkbenchSqlitePath(),
) {
  const people = createPeopleDirectoryStore(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  db.exec("PRAGMA busy_timeout=5000");

  function displayName(userId: unknown): string {
    const normalized = String(userId ?? "").trim();
    if (!normalized) return "暂未指定";
    const testActor = getQualityTestActorByUserId(normalized);
    if (testActor) return testActor.displayName;
    return people.getContact(normalized)?.name?.trim() || "相关人员";
  }

  function eventRow(eventId: string): DatabaseRow | null {
    return db.prepare("SELECT * FROM quality_events WHERE id=? AND deleted_at IS NULL")
      .get(eventId) as DatabaseRow | undefined ?? null;
  }

  function nodes(eventId: string): DatabaseRow[] {
    return db.prepare(`
      SELECT * FROM quality_assignment_nodes
      WHERE event_id=? AND status<>'CANCELLED'
      ORDER BY depth,created_at,node_id
    `).all(eventId) as DatabaseRow[];
  }

  function activeRoot(allNodes: DatabaseRow[]): DatabaseRow | null {
    const roots = allNodes.filter((node) => node.parent_node_id == null && String(node.status) !== "REJECTED");
    return roots.at(-1) ?? null;
  }

  function eventDisposition(eventId: string): {
    code: "UNASSESSED" | "ORDINARY" | "QUALITY_ANOMALY";
    label: string;
  } | null {
    if (!tableExists(db, "quality_event_source_links")) return null;
    const rows = db.prepare(`
      SELECT
        assessment.handling_recommendation,
        assessment.version AS assessment_version,
        review.status AS review_status,
        review.assessment_version AS reviewed_assessment_version,
        review.event_id AS review_event_id
      FROM quality_event_source_links link
      LEFT JOIN quality_source_assessments assessment
        ON assessment.source_key=link.source_key
      LEFT JOIN quality_source_reviews review ON review.source_key=link.source_key
      WHERE link.event_id=?
      ORDER BY link.linked_at,link.source_key
    `).all(eventId) as DatabaseRow[];
    if (rows.length === 0) return null;
    const reviewsLatestAssessment = (row: DatabaseRow) =>
      row.assessment_version != null
      && row.reviewed_assessment_version != null
      && Number(row.reviewed_assessment_version) === Number(row.assessment_version);
    if (rows.some((row) => String(row.review_status) === "REPORTED"
      && String(row.review_event_id) === eventId
      && reviewsLatestAssessment(row)
      && String(row.handling_recommendation) === "QUALITY_ANOMALY")) {
      return { code: "QUALITY_ANOMALY", label: "质量事件" };
    }
    if (rows.every((row) => String(row.review_status) === "ORDINARY"
      && reviewsLatestAssessment(row)
      && String(row.handling_recommendation) === "ORDINARY")) {
      return { code: "ORDINARY", label: "普通事件" };
    }
    return { code: "UNASSESSED", label: "待判断是否属于质量事件" };
  }

  function employeeFormalSubtasks(eventId: string, actorUserId: string) {
    return listQualityFormalSubtasksFromDb(db, {
      eventId,
      assigneeUserId: actorUserId,
    });
  }

  function managerFormalSubtasks(eventId: string, managerUserId: string) {
    return listQualityFormalSubtasksFromDb(db, { eventId })
      .filter((item) => item.managerUserId === managerUserId);
  }

  function formalManagerStage(
    item: QualityFormalSubtaskProjection,
    eventStatus: string,
  ): QualityManagerTaskStage {
    if (eventStatus === "CLOSED") return "CLOSED";
    const stage = qualityEmployeeTaskStage(item.status, item.openDeclineKind);
    if (stage === "WAITING_MANAGER") return "DELEGATE";
    if (stage === "ASSIGNED") return "WAITING_EMPLOYEE";
    if (stage === "ACTIVE") return "EXECUTION";
    return "REVIEW";
  }

  function legacyManagerStage(status: unknown, eventStatus: string): QualityManagerTaskStage {
    if (eventStatus === "CLOSED") return "CLOSED";
    const normalized = String(status ?? "").trim().toUpperCase();
    if (normalized === "PENDING_ACCEPTANCE") return "WAITING_EMPLOYEE";
    if (["IN_PROGRESS", "RETURNED"].includes(normalized)) return "EXECUTION";
    if (["PENDING_PARENT_REVIEW", "APPROVED"].includes(normalized)) return "REVIEW";
    return "DELEGATE";
  }

  function legacyAssignmentStatusLabel(status: unknown, eventStatus: string): string {
    if (eventStatus === "CLOSED") return "已关闭";
    const normalized = String(status ?? "").trim().toUpperCase();
    if (normalized === "PENDING_ACCEPTANCE") return "待员工承接";
    if (normalized === "IN_PROGRESS") return "执行中";
    if (normalized === "RETURNED") return "退回后处理中";
    if (normalized === "PENDING_PARENT_REVIEW") return "已提交，待我验收";
    if (normalized === "APPROVED") return "已验收";
    if (normalized === "REJECTED") return "已拒绝，待重新分派";
    return "等待主管分派员工";
  }

  function linkedFormalTask(nodeId: string): { taskNo: string; subtaskId: string } | null {
    if (!["quality_task_links", "tasks", "subtasks"].every((table) => tableExists(db, table))) {
      return null;
    }
    const row = db.prepare(`
      SELECT t.task_no,l.subtask_id
      FROM quality_task_links l
      JOIN tasks t ON t.task_id=l.task_id
      JOIN subtasks s ON s.subtask_id=l.subtask_id AND s.task_id=t.task_id
      WHERE l.node_id=?
      LIMIT 1
    `).get(nodeId) as DatabaseRow | undefined;
    return row
      ? { taskNo: String(row.task_no), subtaskId: String(row.subtask_id) }
      : null;
  }

  function managerTaskUrl(input: {
    eventId: string;
    managerUserId: string;
    managerStage: QualityManagerTaskStage;
    taskNo: string;
    subtaskId: string;
  }): string {
    const returnQuery = new URLSearchParams({
      eventId: input.eventId,
      managerStage: input.managerStage,
    });
    const testActor = getQualityTestActorByUserId(input.managerUserId);
    if (testActor) returnQuery.set("testActor", testActor.actorRef);
    const query = new URLSearchParams({
      taskNo: input.taskNo,
      subtaskId: input.subtaskId,
      focus: "quality-review",
      returnTo: `/workbench/quality?${returnQuery.toString()}`,
    });
    return `/workbench/manager/task?${query.toString()}`;
  }

  function managerAssignmentItems(input: {
    row: DatabaseRow;
    managerUserId: string;
    allNodes: DatabaseRow[];
    formalSubtasks: QualityFormalSubtaskProjection[];
  }): QualityManagerAssignmentItemViewModel[] {
    const eventStatus = String(input.row.status);
    if (input.formalSubtasks.length > 0) {
      const reviewContexts = getManagerQualityReviewContextsBySubtaskIds(
        input.formalSubtasks.map((item) => item.subtaskId),
        input.managerUserId,
        dbPath,
      );
      return input.formalSubtasks.map((item) => {
        const reviewContext = reviewContexts.get(item.subtaskId);
        const nodeStatus = String(reviewContext?.nodeStatus ?? "").trim().toUpperCase();
        const managerStage = nodeStatus === "APPROVED" ? "CLOSED"
          : nodeStatus === "RETURNED" ? "EXECUTION"
            : nodeStatus === "PENDING_PARENT_REVIEW" ? "REVIEW"
              : formalManagerStage(item, eventStatus);
        const normalizedStatus = String(item.status).trim().toUpperCase();
        const needsReassignment = item.openDeclineKind === "rejected"
          || normalizedStatus === "REJECTED";
        const needsManagerAction = !needsReassignment && (
          item.openDeclineKind === "changes" || normalizedStatus === "CHANGES_REQUESTED"
        );
        const employeeName = displayName(item.assigneeUserId);
        const reviewStatusLabel = reviewContext?.reviewDecision === "APPROVE"
          || nodeStatus === "APPROVED" ? "验收通过"
          : reviewContext?.reviewDecision === "RETURN" || nodeStatus === "RETURNED"
            ? "已退回重做"
            : reviewContext?.canReview || nodeStatus === "PENDING_PARENT_REVIEW"
              ? "待主管验收" : "待员工提交";
        const statusLabel = reviewStatusLabel === "验收通过" ? reviewStatusLabel
          : reviewStatusLabel === "已退回重做" ? "已退回，员工补充中"
            : managerStage === "CLOSED" ? "已关闭"
              : managerStage === "REVIEW" ? "已提交，待我验收"
            : needsReassignment ? "已拒绝，待重新分派"
              : needsManagerAction ? "调整申请，待主管处理"
                : managerStage === "WAITING_EMPLOYEE" ? "待员工承接"
                  : qualityFormalTaskStatusLabel(item.status, item.openDeclineKind);
        return {
          actionRef: item.subtaskId,
          assigneeName: needsReassignment ? "待重新分派" : employeeName,
          assignmentKind: needsReassignment ? "REASSIGN_REQUIRED"
            : needsManagerAction ? "MANAGER_ACTION_REQUIRED" : "ASSIGNED",
          previousAssigneeName: needsReassignment ? employeeName : null,
          actionReason: item.openDeclineReason,
          itemTitle: item.subtaskTitle,
          objective: item.objective,
          deliverables: item.deliverables,
          completionCriteria: item.completionCriteria,
          statusLabel,
          managerStage,
          dueAt: item.dueAt,
          progressNote: item.progressNote,
          updatedAt: item.updatedAt,
          acceptedAt: item.acceptedAt,
          completedAt: item.completedAt,
          submittedAt: reviewContext?.nodeStatus === "PENDING_PARENT_REVIEW"
            || reviewContext?.reviewDecision != null ? item.completedAt : null,
          reviewStatusLabel,
          reviewDecision: reviewContext?.reviewDecision ?? null,
          reviewReason: reviewContext?.reviewReason ?? "",
          reviewedAt: reviewContext?.reviewedAt ?? null,
          evidence: (reviewContext?.evidence ?? []).map((evidence) => ({
            evidenceId: evidence.evidenceId,
            fileName: evidence.originalName,
            summary: evidence.summary,
            uploaderName: displayName(evidence.uploadedBy),
            createdAt: evidence.createdAt,
          })),
          taskNo: item.taskNo,
          taskUrl: managerTaskUrl({
            eventId: String(input.row.id),
            managerUserId: input.managerUserId,
            managerStage,
            taskNo: item.taskNo,
            subtaskId: item.subtaskId,
          }),
          formalProjection: true,
        };
      });
    }

    const byId = new Map(input.allNodes.map((node) => [String(node.node_id), node]));
    const ownNodeIds = new Set(input.allNodes
      .filter((node) => String(node.assignee_user_id) === input.managerUserId
        && !["REJECTED", "CANCELLED"].includes(String(node.status)))
      .map((node) => String(node.node_id)));
    const belongsToManagerBranch = (node: DatabaseRow) => {
      let parentId = nullable(node.parent_node_id);
      const visited = new Set<string>();
      while (parentId && !visited.has(parentId)) {
        if (ownNodeIds.has(parentId)) return true;
        visited.add(parentId);
        parentId = nullable(byId.get(parentId)?.parent_node_id);
      }
      return false;
    };
    const delegated = input.allNodes.filter((node) => belongsToManagerBranch(node));
    if (delegated.length > 0) {
      return delegated.map((node) => {
        const managerStage = legacyManagerStage(node.status, eventStatus);
        const needsReassignment = String(node.status).trim().toUpperCase() === "REJECTED";
        const employeeName = displayName(node.assignee_user_id);
        const formalLink = linkedFormalTask(String(node.node_id));
        return {
          actionRef: String(node.node_id),
          assigneeName: needsReassignment ? "待重新分派" : employeeName,
          assignmentKind: needsReassignment ? "REASSIGN_REQUIRED"
            : managerStage === "DELEGATE" ? "MANAGER_ACTION_REQUIRED" : "ASSIGNED",
          previousAssigneeName: needsReassignment ? employeeName : null,
          actionReason: "",
          itemTitle: nullable(node.requirement) ?? "分配事项待补充",
          objective: nullable(node.requirement) ?? "",
          deliverables: "",
          completionCriteria: "",
          statusLabel: legacyAssignmentStatusLabel(node.status, eventStatus),
          managerStage,
          dueAt: nullable(node.due_at),
          progressNote: "",
          updatedAt: String(node.updated_at ?? ""),
          acceptedAt: nullable(node.accepted_at),
          completedAt: nullable(node.submitted_at),
          submittedAt: nullable(node.submitted_at),
          reviewStatusLabel: String(node.status) === "APPROVED" ? "验收通过"
            : String(node.status) === "RETURNED" ? "已退回重做"
              : String(node.status) === "PENDING_PARENT_REVIEW" ? "待主管验收" : "待员工提交",
          reviewDecision: String(node.status) === "APPROVED" ? "APPROVE"
            : String(node.status) === "RETURNED" ? "RETURN" : null,
          reviewReason: "",
          reviewedAt: null,
          evidence: [],
          taskNo: formalLink?.taskNo ?? null,
          taskUrl: formalLink
            ? managerTaskUrl({
                eventId: String(input.row.id),
                managerUserId: input.managerUserId,
                managerStage,
                taskNo: formalLink.taskNo,
                subtaskId: formalLink.subtaskId,
              })
            : null,
          formalProjection: false,
        };
      });
    }

    const ownNode = input.allNodes.find((node) => ownNodeIds.has(String(node.node_id)));
    const awaitingManagerAcceptance = String(ownNode?.status ?? "") === "PENDING_ACCEPTANCE";
    return ownNode || eventStatus !== "CLOSED"
      ? [{
          actionRef: ownNode ? String(ownNode.node_id) : String(input.row.id),
          assigneeName: awaitingManagerAcceptance ? displayName(ownNode?.assignee_user_id) : "未分派员工",
          assignmentKind: awaitingManagerAcceptance ? "MANAGER_ACTION_REQUIRED" : "UNASSIGNED",
          previousAssigneeName: null,
          actionReason: "",
          itemTitle: nullable(ownNode?.requirement) ?? nullable(input.row.problem_status) ?? String(input.row.title),
          objective: nullable(ownNode?.requirement) ?? "",
          deliverables: "",
          completionCriteria: "",
          statusLabel: eventStatus === "CLOSED" ? "已关闭"
            : awaitingManagerAcceptance ? "待主管承接" : "等待主管分派员工",
          managerStage: eventStatus === "CLOSED" ? "CLOSED"
            : awaitingManagerAcceptance ? "ACCEPT" : "DELEGATE",
          dueAt: nullable(ownNode?.due_at) ?? nullable(input.row.overall_due_at),
          progressNote: "",
          updatedAt: String(input.row.updated_at ?? ""),
          acceptedAt: nullable(ownNode?.accepted_at),
          completedAt: null,
          submittedAt: null,
          reviewStatusLabel: awaitingManagerAcceptance ? "待主管承接" : "待员工提交",
          reviewDecision: null,
          reviewReason: "",
          reviewedAt: null,
          evidence: [],
          taskNo: null,
          taskUrl: null,
          formalProjection: false,
        }]
      : [];
  }

  function projectedEvidence(row: DatabaseRow): QualityProjectedEvidenceViewModel {
    const evidenceId = String(row.evidence_id);
    const mimeType = String(row.mime_type ?? "application/octet-stream").trim()
      || "application/octet-stream";
    const evidenceUrl = `/api/workbench/quality/evidence/${encodeURIComponent(evidenceId)}`;
    return {
      evidenceId,
      nodeId: String(row.node_id),
      version: Number(row.evidence_version),
      fileName: String(row.original_name ?? "质量证据"),
      summary: String(row.summary ?? ""),
      mimeType,
      sizeBytes: Number(row.size_bytes ?? 0),
      uploaderName: displayName(row.uploaded_by),
      createdAt: String(row.created_at ?? ""),
      previewable: mimeType.startsWith("image/")
        || mimeType.startsWith("text/")
        || ["application/pdf", "application/json", "application/xml"].includes(mimeType),
      previewUrl: evidenceUrl,
      downloadUrl: `${evidenceUrl}?download=1`,
    };
  }

  function qualityManagementAssignmentItems(input: {
    eventId: string;
    formalSubtasks: QualityFormalSubtaskProjection[];
    evidenceRows: DatabaseRow[];
    reviewRows: DatabaseRow[];
  }): QualityManagementAssignmentItemViewModel[] {
    if (input.formalSubtasks.length === 0 || !tableExists(db, "subtasks")) return [];
    const subtaskIds = input.formalSubtasks.map((item) => item.subtaskId);
    const placeholders = subtaskIds.map(() => "?").join(",");
    const dependsOnSelect = tableHasColumn(db, "subtasks", "depends_on")
      ? "s.depends_on"
      : "NULL AS depends_on";
    const hasQualityLinks = tableExists(db, "quality_task_links")
      && tableExists(db, "quality_assignment_nodes");
    const metadataRows = hasQualityLinks
      ? db.prepare(`
          SELECT s.subtask_id,s.source_task_key,${dependsOnSelect},
                 n.node_id,n.parent_node_id,n.status AS node_status
          FROM subtasks s
          LEFT JOIN quality_task_links l
            ON l.subtask_id=s.subtask_id AND l.task_id=s.task_id
          LEFT JOIN quality_assignment_nodes n
            ON n.node_id=l.node_id AND n.event_id=? AND n.status<>'CANCELLED'
          WHERE s.subtask_id IN (${placeholders})
        `).all(input.eventId, ...subtaskIds) as DatabaseRow[]
      : db.prepare(`
          SELECT s.subtask_id,s.source_task_key,${dependsOnSelect},
                 NULL AS node_id,NULL AS parent_node_id,NULL AS node_status
          FROM subtasks s
          WHERE s.subtask_id IN (${placeholders})
        `).all(...subtaskIds) as DatabaseRow[];
    const metadataBySubtask = new Map(metadataRows
      .map((row) => [String(row.subtask_id), row] as const));

    const evidenceByNode = new Map<string, QualityProjectedEvidenceViewModel[]>();
    for (const row of input.evidenceRows) {
      const nodeId = String(row.node_id);
      const items = evidenceByNode.get(nodeId) ?? [];
      items.push(projectedEvidence(row));
      evidenceByNode.set(nodeId, items);
    }
    for (const items of evidenceByNode.values()) {
      items.sort((left, right) => left.version - right.version
        || left.createdAt.localeCompare(right.createdAt)
        || left.evidenceId.localeCompare(right.evidenceId));
    }

    const latestReviewByNode = new Map<string, DatabaseRow>();
    for (const row of input.reviewRows) latestReviewByNode.set(String(row.node_id), row);

    return input.formalSubtasks.map((item) => {
      const metadata = metadataBySubtask.get(item.subtaskId);
      const nodeId = nullable(metadata?.node_id);
      const nodeStatus = nullable(metadata?.node_status)?.toUpperCase() ?? null;
      const latestReview = nodeId ? latestReviewByNode.get(nodeId) : undefined;
      const reviewCode = nullable(latestReview?.decision)?.toUpperCase();
      const reviewDecision = reviewCode === "APPROVE" || reviewCode === "RETURN"
        ? reviewCode
        : null;
      const reviewStatusLabel = nodeStatus === "APPROVED" ? "主管已验收"
        : nodeStatus === "RETURNED" ? "主管已退回重做"
          : nodeStatus === "PENDING_PARENT_REVIEW"
            || String(item.status).trim().toUpperCase() === "DONE" ? "待主管验收"
            : reviewDecision === "RETURN" ? "已退回，员工补充中"
              : "待员工提交";
      return {
        actionRef: item.subtaskId,
        nodeId,
        parentNodeId: nullable(metadata?.parent_node_id),
        sourceTaskKey: String(metadata?.source_task_key ?? ""),
        assigneeName: displayName(item.assigneeUserId),
        itemTitle: item.subtaskTitle,
        objective: item.objective,
        deliverables: item.deliverables,
        completionCriteria: item.completionCriteria,
        statusLabel: qualityFormalTaskStatusLabel(item.status, item.openDeclineKind),
        nodeStatus,
        dueAt: item.dueAt,
        dependsOn: parseStringArray(metadata?.depends_on),
        progressNote: item.progressNote,
        updatedAt: item.updatedAt,
        acceptedAt: item.acceptedAt,
        completedAt: item.completedAt,
        reviewStatusLabel,
        reviewDecision,
        reviewReason: String(latestReview?.reason ?? ""),
        reviewedAt: nullable(latestReview?.created_at),
        reviewedEvidenceVersion: latestReview?.evidence_version == null
          ? null
          : Number(latestReview.evidence_version),
        evidence: nodeId ? evidenceByNode.get(nodeId) ?? [] : [],
        taskNo: item.taskNo,
        taskId: item.taskId,
        subtaskId: item.subtaskId,
        formalProjection: true,
      };
    });
  }

  function attentionFor(row: DatabaseRow, context: QualityPerspectiveContext) {
    const status = String(row.status);
    if (status === "CLOSED") return { bucket: "DONE" as const, label: "已关闭" };
    const allNodes = nodes(String(row.id));
    if (context.perspective === "aftersales") {
      const disposition = eventDisposition(String(row.id));
      if (status === "PENDING_ANALYSIS" && disposition?.code === "ORDINARY") {
        return { bucket: "DONE" as const, label: "普通事件（已记录）" };
      }
      if (status === "PENDING_ANALYSIS" && disposition?.code === "UNASSESSED") {
        return { bucket: "TODO" as const, label: "待我研判" };
      }
      if (status === "PENDING_ANALYSIS" && disposition?.code === "QUALITY_ANOMALY") {
        return { bucket: "PROGRESS" as const, label: "待质量初析" };
      }
      return {
        bucket: status === "PENDING_ANALYSIS" ? "TODO" as const : "PROGRESS" as const,
        label: qualityStatusLabel(status),
      };
    }
    if (context.perspective === "quality_management") {
      return {
        bucket: ["PENDING_ANALYSIS", "PENDING_ASSIGNMENT", "PENDING_QUALITY_REVIEW"].includes(status)
          ? "TODO" as const
          : "PROGRESS" as const,
        label: qualityStatusLabel(status),
      };
    }
    if (context.perspective === "employee") {
      const formal = employeeFormalSubtasks(String(row.id), context.actorUserId);
      const stages = new Set(formal.map((item) => qualityEmployeeTaskStage(
        item.status,
        item.openDeclineKind,
      )));
      if (stages.has("ASSIGNED")) return { bucket: "TODO" as const, label: "待我承接" };
      if (stages.has("ACTIVE")) return { bucket: "PROGRESS" as const, label: "执行中" };
      if (stages.has("WAITING_MANAGER")) return { bucket: "TODO" as const, label: "待主管处理" };
      if (formal.length > 0) return { bucket: "DONE" as const, label: "已完成" };
    }
    if (context.perspective === "manager") {
      const managerStage = resolveQualityManagerTaskStageFromDb({
        db,
        eventId: String(row.id),
        eventStatus: status,
        managerUserId: context.actorUserId,
      });
      if (managerStage) {
        return {
          bucket: qualityManagerTaskStageBucket(managerStage),
          label: qualityManagerTaskStageLabel(managerStage),
        };
      }
    }
    return { bucket: "PROGRESS" as const, label: qualityStatusLabel(status) };
  }

  function summary(row: DatabaseRow, context: QualityPerspectiveContext): QualityEventSummaryViewModel {
    const allNodes = nodes(String(row.id));
    const root = activeRoot(allNodes);
    const attention = attentionFor(row, context);
    const formalEmployeeTasks = context.perspective === "employee"
      ? employeeFormalSubtasks(String(row.id), context.actorUserId)
      : [];
    const formalManagerTasks = context.perspective === "manager"
      ? managerFormalSubtasks(String(row.id), context.actorUserId)
      : [];
    const assignmentItems = context.perspective === "manager"
      ? managerAssignmentItems({
          row,
          managerUserId: context.actorUserId,
          allNodes,
          formalSubtasks: formalManagerTasks,
        })
      : [];
    const disposition = eventDisposition(String(row.id));
    const riskPendingReview = context.perspective === "aftersales"
      && String(row.status) === "PENDING_ANALYSIS"
      && disposition?.code === "UNASSESSED";
    const statusLabel = context.perspective === "aftersales"
      && String(row.status) === "PENDING_ANALYSIS"
      ? disposition?.code === "ORDINARY" ? "普通事件（已记录）"
        : disposition?.code === "UNASSESSED" ? "待质量研判"
          : qualityStatusLabel(row.status)
      : qualityStatusLabel(row.status);
    const viewModel: QualityEventSummaryViewModel = {
      actionRef: String(row.id),
      eventNumber: String(row.event_no),
      title: String(row.title),
      statusLabel,
      attentionBucket: attention.bucket,
      attentionLabel: attention.label,
      urgencyLabel: riskPendingReview ? "待研判" : qualityUrgencyLabel(row.urgency),
      currentOwnerName: formalEmployeeTasks.length > 0
        ? displayName(context.actorUserId)
        : displayName(root?.assignee_user_id),
      currentDepartmentName: formalEmployeeTasks.length > 0
        ? "原员工任务系统"
        : nullable(root?.department_name) ?? "暂未指定",
      updatedAt: String(row.updated_at),
      testBadge: Number(row.is_test ?? 0) === 1 ? "测试事件" : null,
      managerStages: [...new Set(assignmentItems.map((item) => item.managerStage))],
      assignmentItems,
      dispositionCode: disposition?.code ?? null,
      dispositionLabel: disposition?.label ?? null,
    };
    // Filtering uses the authoritative stored status, while the public API
    // continues to expose only the role-specific Chinese presentation label.
    Object.defineProperty(viewModel, "statusCode", {
      value: String(row.status),
      enumerable: false,
    });
    return viewModel as QualityEventSummaryViewModel & { statusCode: string };
  }

  function canSeeEvent(row: DatabaseRow, context: QualityPerspectiveContext): boolean {
    const isTest = Number(row.is_test ?? 0) === 1;
    if ((context.scope === "test") !== isTest) return false;
    if (context.isAdmin && context.scope === "real") return true;
    if (context.perspective === "dashboard") return context.isAdmin;
    if (context.perspective === "aftersales") return String(row.created_by) === context.actorUserId;
    if (context.perspective === "quality_management") {
      const disposition = eventDisposition(String(row.id));
      if (isTest && String(row.status) === "PENDING_ANALYSIS"
        && disposition != null && disposition.code !== "QUALITY_ANOMALY") return false;
      return String(row.status) !== "DRAFT";
    }
    if (context.perspective === "employee"
      && employeeFormalSubtasks(String(row.id), context.actorUserId).length > 0) return true;
    if (context.perspective === "manager"
      && managerFormalSubtasks(String(row.id), context.actorUserId).length > 0) return true;
    return nodes(String(row.id)).some((node) => String(node.assignee_user_id) === context.actorUserId);
  }

  function listEvents(input: QualityPerspectiveRequest) {
    const context = resolveQualityPerspectiveContext(input);
    const rows = db.prepare(`
      SELECT * FROM quality_events
      WHERE deleted_at IS NULL AND is_test=?
      ORDER BY updated_at DESC,id
    `).all(context.scope === "test" ? 1 : 0) as DatabaseRow[];
    const visible = rows.filter((row) => canSeeEvent(row, context));
    const events = visible.map((row) => summary(row, context));
    const stages = visible.map((row) => stageKey(row.status));
    const stats = {
      total: events.length,
      awaitingAction: stages.filter((stage) => ["awaiting-supervisor", "awaiting-acceptance", "manager-review", "quality-review"].includes(stage)).length,
      inProgress: stages.filter((stage) => stage === "in-progress").length,
      closed: stages.filter((stage) => stage === "closed").length,
    };
    return { context, events, stats };
  }

  function factRows(eventId: string) {
    const links = db.prepare(`
      SELECT source_snapshot_json FROM quality_event_source_links
      WHERE event_id=? ORDER BY linked_at,id
    `).all(eventId) as DatabaseRow[];
    const facts: Array<{ label: string; value: string }> = [];
    const seen = new Set<string>();
    for (const link of links) {
      const snapshot = parseObject(link.source_snapshot_json);
      for (const field of FACT_FIELDS) {
        const value = field.keys.map((key) => nullable(snapshot[key])).find(Boolean);
        if (!value || seen.has(`${field.label}:${value}`)) continue;
        seen.add(`${field.label}:${value}`);
        facts.push({ label: field.label, value });
      }
    }
    return facts.slice(0, 80);
  }

  function categoryLabel(
    primaryCode: unknown,
    secondaryCode: unknown,
    customPrimary?: unknown,
    customSecondary?: unknown,
  ): string {
    const custom = [nullable(customPrimary), nullable(customSecondary)].filter(Boolean).join("／");
    if (custom) return custom;
    const primary = HISTORICAL_FEEDBACK_TAXONOMY_V0.categories.find(
      (item) => item.primaryCode === String(primaryCode ?? ""),
    );
    const secondary = primary?.secondaryCategories.find(
      (item) => item.secondaryCode === String(secondaryCode ?? ""),
    );
    return [primary?.primaryLabel, secondary?.secondaryLabel].filter(Boolean).join("／")
      || "分类待确认";
  }

  function originalAssessment(eventId: string) {
    const row = tableExists(db, "quality_source_ai_assessments")
      ? db.prepare(`
          SELECT ai.output_json,ai.created_at,ai.created_by
          FROM quality_source_ai_assessments ai
          JOIN quality_event_source_links link ON link.source_key=ai.source_key
          WHERE link.event_id=?
          ORDER BY ai.source_version DESC,ai.created_at DESC
          LIMIT 1
        `).get(eventId) as DatabaseRow | undefined
      : undefined;
    const ai = row ? parseObject(row.output_json) : null;
    const provenance = ai ? parseObject(ai.provenance) : {};
    const modelConfigId = nullable(provenance.modelConfigId);
    const reasoning = Array.isArray(ai?.reasoningBasis)
      ? ai!.reasoningBasis as Array<Record<string, unknown>>
      : [];
    const missing = Array.isArray(ai?.missingInformation)
      ? ai!.missingInformation as Array<Record<string, unknown>>
      : [];
    const recommendation = ai?.handlingRecommendation;
    const risk = String(ai?.riskLevel ?? "");
    const riskLabel = risk === "HIGH" ? "高风险"
      : risk === "MEDIUM" ? "中风险"
        : risk === "LOW" ? "低风险" : "风险待人工确认";
    const evidenceStrength = missing.length === 0
      ? "证据较强"
      : missing.length <= 2 ? "一般" : "证据不足";
    return {
      available: ai != null,
      summary: nullable(ai?.summary)
        ?? (ai
          ? `AI建议：${qualityDecisionLabel(recommendation)}；建议分类：${categoryLabel(ai?.primaryCategoryCode, ai?.secondaryCategoryCode)}。`
          : "当前事件未保存 AI 原始研判建议。"),
      recommendedDecision: recommendation == null
        ? "建议暂不可用"
        : qualityDecisionLabel(recommendation),
      recommendedDecisionCode: recommendation == null ? null : String(recommendation),
      suggestedCategory: ai
        ? categoryLabel(ai.primaryCategoryCode, ai.secondaryCategoryCode)
        : "分类待确认",
      primaryCategoryCode: nullable(ai?.primaryCategoryCode),
      secondaryCategoryCode: nullable(ai?.secondaryCategoryCode),
      suggestedRisk: riskLabel,
      evidenceStrength: ai ? evidenceStrength : "证据情况暂不可用",
      reasons: reasoning.map((item) => nullable(item.statement)).filter(Boolean).slice(0, 20),
      missingInformation: missing.map((item) => {
        const field = nullable(item.field);
        const reason = nullable(item.reason);
        return [field, reason].filter(Boolean).join("：");
      }).filter(Boolean).slice(0, 20),
      generationSource: modelConfigId === "quality-test-fixture" ? "FIXTURE" : ai ? "MODEL" : "NONE",
      generationLabel: modelConfigId === "quality-test-fixture"
        ? "预置测试建议（尚未调用AI）"
        : ai ? "AI模型生成" : "尚未生成",
      generatedAt: row?.created_at == null ? null : String(row.created_at),
      modelConfigId,
    };
  }

  function finalAssessment(eventId: string) {
    if (!tableExists(db, "quality_source_assessments")) return [];
    return (db.prepare(`
      SELECT assessment.*,review.status AS disposition_status,review.note AS disposition_note,
             review.decided_at AS disposition_at
      FROM quality_source_assessments assessment
      JOIN quality_event_source_links link ON link.source_key=assessment.source_key
      LEFT JOIN quality_source_reviews review ON review.source_key=assessment.source_key
      WHERE link.event_id=?
      ORDER BY assessment.updated_at DESC
    `).all(eventId) as DatabaseRow[]).map((row) => ({
      conclusion: qualityDecisionLabel(row.handling_recommendation),
      handlingCode: String(row.handling_recommendation),
      category: categoryLabel(
        row.primary_category_code,
        row.secondary_category_code,
        row.custom_primary_category_name,
        row.custom_secondary_category_name,
      ),
      riskLabel: qualityUrgencyLabel(row.risk_level),
      riskCode: String(row.risk_level),
      note: nullable(row.conclusion) ?? "无补充说明",
      adoptionLabel: String(row.adoption_mode) === "DIRECT" ? "直接采纳"
        : String(row.adoption_mode) === "MODIFIED" ? "修改后采纳" : "人工研判",
      adoptionCode: String(row.adoption_mode),
      categoryMode: String(row.category_mode),
      primaryCategoryCode: nullable(row.primary_category_code),
      secondaryCategoryCode: nullable(row.secondary_category_code),
      customPrimaryCategoryName: nullable(row.custom_primary_category_name),
      customSecondaryCategoryName: nullable(row.custom_secondary_category_name),
      changeReason: nullable(row.change_reason),
      dispositionLabel: row.disposition_status == null
        ? "尚未正式处置"
        : qualityDecisionLabel(row.disposition_status),
      reviewerName: displayName(row.reviewed_by),
      decidedAt: String(row.updated_at),
    }));
  }

  function initialAnalysis(eventId: string, perspective: QualityPerspective) {
    if (!tableExists(db, "quality_analysis_versions")) return { latest: null, versions: [] };
    const rows = db.prepare(`
      SELECT * FROM quality_analysis_versions
      WHERE event_id=? ORDER BY analysis_version DESC
    `).all(eventId) as DatabaseRow[];
    const allowed = perspective === "manager" || perspective === "employee" ? rows.slice(0, 1) : rows;
    const versions = allowed.map((row) => ({
      actionRef: String(row.analysis_id),
      versionLabel: `V${Number(row.analysis_version)}`,
      statusLabel: "已完成初析",
      problemDirection: nullable(parseObject(row.content_json).problemDirection) ?? "信息暂不可用",
      confirmedCategory: nullable(parseObject(row.content_json).confirmedCategoryReference) ?? "信息暂不可用",
      sourceSummary: (Array.isArray(parseObject(row.content_json).sourceFactSummary)
        ? parseObject(row.content_json).sourceFactSummary as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      analysisBasis: (Array.isArray(parseObject(row.content_json).analysisBasis)
        ? parseObject(row.content_json).analysisBasis as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      initialConclusion: nullable(parseObject(row.content_json).preliminaryConclusion) ?? "信息暂不可用",
      informationGaps: (Array.isArray(parseObject(row.content_json).informationGaps)
        ? parseObject(row.content_json).informationGaps as unknown[] : [])
        .map(String).join("；") || "暂无",
      suggestedDepartment: nullable(row.primary_department_name) ?? "部门待确认",
      processingRequirements: (Array.isArray(parseObject(row.content_json).handlingRequirements)
        ? parseObject(row.content_json).handlingRequirements as unknown[] : [])
        .map(String).join("；") || "信息暂不可用",
      deliverables: parseArray(row.deliverables_json).map((item) => {
        const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
        return {
          name: nullable(value.name) ?? "待确认成果",
          description: nullable(value.description) ?? "",
          acceptanceCriteria: nullable(value.acceptanceCriteria) ?? "",
          selected: value.selected !== false,
        };
      }).filter((item) => item.selected),
      suggestedDueAt: String(row.suggested_total_due_at),
      updatedAt: String(row.confirmed_at),
    }));
    return { latest: versions[0] ?? null, versions };
  }

  function testInitialAnalysisDraft(eventId: string, event: DatabaseRow) {
    const ai = originalAssessment(eventId);
    const finalReview = finalAssessment(eventId)[0];
    const attemptRow = tableExists(db, "quality_analysis_attempts")
      ? db.prepare(`
          SELECT * FROM quality_analysis_attempts
          WHERE event_id=? AND status='SUCCEEDED' AND output_json IS NOT NULL
          ORDER BY attempt_no DESC LIMIT 1
        `).get(eventId) as DatabaseRow | undefined
      : undefined;
    const generated = attemptRow ? parseObject(attemptRow.output_json) : null;
    const generatedBasis = Array.isArray(generated?.analysisBasis)
      ? generated!.analysisBasis as Array<Record<string, unknown>>
      : [];
    const generatedDeliverables = Array.isArray(generated?.deliverables)
      ? generated!.deliverables as Array<Record<string, unknown>>
      : [];
    const generatedDepartments = Array.isArray(generated?.primaryDepartmentCandidates)
      ? generated!.primaryDepartmentCandidates as Array<Record<string, unknown>>
      : [];
    const generatedDueDays = Number(generated?.suggestedTotalDueDays);
    const sourceSummary = [
      nullable(event.problem_status),
      ...factRows(eventId).slice(0, 4).map((item) => `${item.label}：${item.value}`),
    ].filter(Boolean);
    const baseTime = Date.parse(String(event.updated_at ?? ""));
    const fallbackDueAt = new Date(
      (Number.isFinite(baseTime) ? baseTime : Date.now())
        + (Number.isFinite(generatedDueDays) && generatedDueDays > 0 ? generatedDueDays : 30)
          * 24 * 60 * 60 * 1000,
    ).toISOString();
    const category = finalReview?.category ?? nullable(event.initial_category) ?? ai.suggestedCategory;
    const firstDeliverable = generatedDeliverables[0];
    return {
      aiSummary: generated
        ? "AI质量初析已生成并预填；请由佟成（测试）核对后再确认。"
        : "当前显示预置测试草案，尚未调用AI质量初析模型。",
      evidenceStrength: generated ? "AI模型已生成" : "预置测试草案",
      generationSource: generated ? "MODEL" : "FIXTURE",
      generationLabel: generated ? "AI模型生成" : "预置测试草案（尚未调用AI）",
      generatedAt: attemptRow?.completed_at == null ? null : String(attemptRow.completed_at),
      modelName: attemptRow?.model_name == null ? null : String(attemptRow.model_name),
      problemDirection: nullable(generated?.problemDirection) ?? `${category}问题原因核验`,
      confirmedCategory: nullable(generated?.confirmedCategoryReference) ?? category,
      sourceFactSummary: (Array.isArray(generated?.sourceFactSummary)
        ? generated!.sourceFactSummary as unknown[] : sourceSummary).map(String).join("\n"),
      analysisBasis: (generatedBasis.length
        ? generatedBasis.map((item) => nullable(item.statement)).filter(Boolean)
        : ai.reasons.length ? ai.reasons : [
        "依据来源事实、AI原始研判和主管最终研判进行质量初析。",
      ]).join("\n"),
      preliminaryConclusion: nullable(generated?.preliminaryConclusion)
        ?? "建议由研发中心完成原因排查、措施制定与验证。",
      informationGaps: (Array.isArray(generated?.informationGaps)
        ? generated!.informationGaps as unknown[] : ai.missingInformation).map(String).join("\n"),
      handlingRequirements: (Array.isArray(generated?.handlingRequirements)
        ? generated!.handlingRequirements as unknown[] : [
        "完成原因核查并形成明确结论",
        "制定处理措施并上传验证证据",
        "按责任链逐级完成验收",
      ]).map(String).join("\n"),
      suggestedDepartment: nullable(generatedDepartments[0]?.departmentName) ?? "研发中心",
      suggestedDueAt: nullable(event.overall_due_at) ?? fallbackDueAt,
      deliverableName: nullable(firstDeliverable?.name) ?? "原因排查与验证记录",
      deliverableDescription: nullable(firstDeliverable?.description)
        ?? "形成可复核的原因排查、处理措施和验证记录。",
      acceptanceCriteria: nullable(firstDeliverable?.acceptanceCriteria)
        ?? "包含事实依据、原因结论、处理措施、验证结果和必要证据。",
    };
  }

  function visibleNodes(allNodes: DatabaseRow[], context: QualityPerspectiveContext): DatabaseRow[] {
    if (context.perspective !== "manager" && context.perspective !== "employee") return allNodes;
    if (context.perspective === "employee") {
      return allNodes.filter((node) => String(node.assignee_user_id) === context.actorUserId);
    }
    const children = new Map<string, DatabaseRow[]>();
    for (const node of allNodes) {
      const parent = nullable(node.parent_node_id);
      if (!parent) continue;
      const bucket = children.get(parent) ?? [];
      bucket.push(node);
      children.set(parent, bucket);
    }
    const result: DatabaseRow[] = [];
    const add = (node: DatabaseRow) => {
      result.push(node);
      for (const child of children.get(String(node.node_id)) ?? []) add(child);
    };
    for (const node of allNodes) {
      if (String(node.assignee_user_id) === context.actorUserId) add(node);
    }
    return [...new Map(result.map((node) => [String(node.node_id), node])).values()];
  }

  function getEventDetail(input: QualityPerspectiveRequest & { eventId: string }) {
    let context = resolveQualityPerspectiveContext(input);
    const row = eventRow(input.eventId);
    if (!row || !canSeeEvent(row, context)) return null;
    const allNodes = nodes(input.eventId);
    if (context.isAdmin && context.scope === "real" && context.perspective === "manager") {
      const root = activeRoot(allNodes);
      if (root) context = { ...context, actorUserId: String(root.assignee_user_id) };
    }
    const branch = visibleNodes(allNodes, context);
    const allFormalTasks = ["quality_management", "manager", "employee"].includes(context.perspective)
      ? listQualityFormalSubtasksFromDb(db, { eventId: input.eventId })
      : [];
    const formalEmployeeTasks = context.perspective === "employee"
      ? allFormalTasks.filter((item) => item.assigneeUserId === context.actorUserId)
      : [];
    const formalManagerTasks = context.perspective === "manager"
      ? allFormalTasks.filter((item) => item.managerUserId === context.actorUserId)
      : [];
    if ((context.perspective === "manager" || context.perspective === "employee")
      && branch.length === 0
      && formalEmployeeTasks.length === 0
      && formalManagerTasks.length === 0) return null;
    const nodeRefs = new Set(branch.map((node) => String(node.node_id)));
    const evidenceRows = tableExists(db, "quality_evidence")
      ? db.prepare("SELECT * FROM quality_evidence WHERE event_id=? ORDER BY created_at,evidence_id").all(input.eventId) as DatabaseRow[]
      : [];
    const reviewRows = tableExists(db, "quality_node_reviews")
      ? db.prepare("SELECT * FROM quality_node_reviews WHERE event_id=? ORDER BY created_at,review_id").all(input.eventId) as DatabaseRow[]
      : [];
    const qualityManagementItems = context.perspective === "quality_management"
      ? qualityManagementAssignmentItems({
          eventId: input.eventId,
          formalSubtasks: allFormalTasks,
          evidenceRows,
          reviewRows,
        })
      : [];
    const auditRows = tableExists(db, "quality_audit_events")
      ? db.prepare("SELECT * FROM quality_audit_events WHERE event_id=? ORDER BY occurred_at,id").all(input.eventId) as DatabaseRow[]
      : [];
    const notificationRows = tableExists(db, "quality_notification_outbox")
      ? db.prepare("SELECT * FROM quality_notification_outbox WHERE event_id=? ORDER BY created_at,notification_id").all(input.eventId) as DatabaseRow[]
      : [];
    const managerAuditVisible = (audit: DatabaseRow) => {
      if (context.perspective !== "manager" && context.perspective !== "employee") return true;
      for (const raw of [audit.before_json, audit.after_json]) {
        const value = parseObject(raw);
        if (value.nodeId != null && nodeRefs.has(String(value.nodeId))) return true;
        if (value.returnedNodeId != null && nodeRefs.has(String(value.returnedNodeId))) return true;
      }
      return String(audit.actor_user_id) === context.actorUserId;
    };
    const root = activeRoot(allNodes);
    const readonly = context.readonly || context.perspective === "dashboard";
    const allowedActions: string[] = [];
    if (!readonly && context.perspective === "quality_management") {
      if (context.scope === "test" && String(row.status) === "PENDING_ANALYSIS") {
        allowedActions.push("generate-analysis-ai", "complete-analysis");
      }
      if (String(row.status) === "PENDING_ASSIGNMENT") allowedActions.push("assign-supervisor");
      if (String(row.status) === "PENDING_QUALITY_REVIEW") allowedActions.push("return-node", "close");
      if (String(row.status) === "CLOSED") allowedActions.push("reopen");
    }
    if (!readonly && context.perspective === "manager") {
      const ownPending = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && String(node.status) === "PENDING_ACCEPTANCE");
      if (ownPending) allowedActions.push("accept", "reject");
      if (formalManagerTasks.length === 0) {
        const ownActive = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
          && ["IN_PROGRESS", "RETURNED"].includes(String(node.status)));
        if (ownActive) allowedActions.push("delegate", "upload-evidence", "submit-completion");
        if (branch.some((node) => String(node.parent_node_id) === ownActive?.node_id
          && String(node.status) === "PENDING_PARENT_REVIEW")) allowedActions.push("review-child");
        if (String(row.status) === "PENDING_PRIMARY_REVIEW"
          && root && String(root.assignee_user_id) === context.actorUserId) allowedActions.push("primary-review");
      }
    }
    if (!readonly && context.perspective === "employee") {
      const ownPending = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && String(node.status) === "PENDING_ACCEPTANCE");
      if (ownPending) allowedActions.push("accept", "reject");
      const ownActive = branch.find((node) => String(node.assignee_user_id) === context.actorUserId
        && ["IN_PROGRESS", "RETURNED"].includes(String(node.status)));
      if (ownActive) allowedActions.push("upload-evidence", "submit-completion");
    }
    if (!readonly && context.perspective === "aftersales" && String(row.status) !== "CLOSED") {
      if (context.scope === "test") {
        if (String(row.status) === "PENDING_ANALYSIS") {
          allowedActions.push("generate-original-ai", "update-aftersales");
        }
      }
      else allowedActions.push("supplement", "correct");
    }
    const viewModel: Record<string, unknown> = {
      scope: context.scope,
      perspective: context.perspective,
      actorUserId: context.actorUserId,
      readonly,
      defaultStage: context.perspective === "quality_management"
        ? qualityManagementDefaultStage(row.status)
        : undefined,
      actorLabel: context.testActor?.displayName
        ?? (context.perspective === "aftersales" ? "马荣鑫视角"
          : context.perspective === "quality_management" ? "佟成视角"
            : context.perspective === "manager" ? "主管视角"
              : context.perspective === "employee" ? "员工视角" : "管理看板"),
      event: {
        ...summary(row, context),
        currentSituation: String(row.problem_status),
        occurredAt: nullable(row.occurred_at),
        feedbackAt: nullable(row.feedback_at),
        feedbackName: nullable(row.feedback_name),
        deviceModel: nullable(row.device_model),
        deviceSerial: nullable(row.device_serial),
        catheterBatch: nullable(row.catheter_batch),
        initialCategory: nullable(row.initial_category),
        urgencyCode: nullable(row.urgency) ?? "MEDIUM",
        impact: nullable(row.impact),
        supplement: nullable(row.supplement),
        overallDueAt: nullable(row.overall_due_at),
        version: Number(row.version),
        dispositionCode: eventDisposition(input.eventId)?.code ?? null,
        dispositionLabel: eventDisposition(input.eventId)?.label ?? null,
      },
      sourceFacts: factRows(input.eventId),
      initialAnalysis: context.perspective === "aftersales" ? undefined : initialAnalysis(input.eventId, context.perspective),
      testAnalysisDraft: context.scope === "test"
        && context.perspective === "quality_management"
        && String(row.status) === "PENDING_ANALYSIS"
        ? testInitialAnalysisDraft(input.eventId, row)
        : undefined,
      supervisorAssignment: {
        assigned: root != null,
        supervisorName: displayName(root?.assignee_user_id),
        departmentName: nullable(root?.department_name) ?? "暂未指定",
        statusLabel: root ? qualityStatusLabel(root.status) : "等待选择主管",
      },
      branch: branch.length > 0
        ? branch.map((node) => ({
            actionRef: String(node.node_id),
            parentActionRef: nullable(node.parent_node_id) && nodeRefs.has(String(node.parent_node_id))
              ? String(node.parent_node_id)
              : null,
            assigneeName: displayName(node.assignee_user_id),
            assigneeTypeLabel: String(node.assignee_kind) === "MANAGER" ? "主管" : "员工",
            departmentName: nullable(node.department_name) ?? "部门待确认",
            statusLabel: qualityStatusLabel(node.status),
            dueAt: String(node.due_at),
            requirement: String(node.requirement),
            acceptedAt: nullable(node.accepted_at),
            version: Number(node.version),
          }))
        : formalEmployeeTasks.map((item) => ({
            actionRef: item.subtaskId,
            parentActionRef: null,
            assigneeName: displayName(item.assigneeUserId),
            assigneeTypeLabel: "员工",
            departmentName: "原员工任务系统",
            statusLabel: qualityFormalTaskStatusLabel(item.status, item.openDeclineKind),
            dueAt: item.dueAt,
            requirement: item.objective || item.subtaskTitle,
            acceptedAt: item.acceptedAt,
            version: 0,
            taskNo: item.taskNo,
            taskId: item.taskId,
            subtaskId: item.subtaskId,
            taskUrl: `/workbench/employee/task?taskNo=${encodeURIComponent(item.taskNo)}`,
            formalProjection: true,
          })),
      qualityAssignmentItems: qualityManagementItems,
      formalTaskProjection: allFormalTasks.length > 0,
      evidence: evidenceRows.filter((item) => !["manager", "employee"].includes(context.perspective) || nodeRefs.has(String(item.node_id))).map((item) => ({
        actionRef: String(item.evidence_id),
        fileName: String(item.original_name),
        summary: String(item.summary ?? ""),
        uploaderName: displayName(item.uploaded_by),
        createdAt: String(item.created_at),
      })),
      reviews: reviewRows.filter((item) => !["manager", "employee"].includes(context.perspective) || nodeRefs.has(String(item.node_id))).map((item) => ({
        reviewerName: displayName(item.reviewer_user_id),
        conclusion: String(item.decision) === "APPROVE" ? "通过" : "退回",
        reason: nullable(item.reason) ?? "无补充说明",
        createdAt: String(item.created_at),
      })),
      audit: auditRows.filter(managerAuditVisible).map((item) => ({
        actorName: displayName(item.actor_user_id),
        actionLabel: qualityActionLabel(item.action),
        reason: nullable(item.reason),
        occurredAt: String(item.occurred_at),
      })),
      notifications: notificationRows
        .filter((item) => !["manager", "employee"].includes(context.perspective) || String(item.recipient_user_id) === context.actorUserId)
        .map((item) => ({
          recipientName: displayName(item.recipient_user_id),
          resultLabel: qualityNotificationLabel(item.status, item.channel),
          subject: String(item.subject),
          createdAt: String(item.created_at),
        })),
      allowedActions,
    };
    if (context.perspective === "aftersales") {
      viewModel.assessment = {
        originalSuggestion: originalAssessment(input.eventId),
        finalReviews: finalAssessment(input.eventId),
      };
    }
    return { context, viewModel };
  }

  return { listEvents, getEventDetail, close: () => { people.close(); db.close(); } };
}
