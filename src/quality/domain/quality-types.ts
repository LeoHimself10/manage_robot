export type QualityEventStatus =
  | "DRAFT"
  | "PENDING_ASSIGNMENT"
  | "PENDING_ACCEPTANCE"
  | "IN_PROGRESS"
  | "PENDING_PRIMARY_REVIEW"
  | "PENDING_QUALITY_REVIEW"
  | "CLOSED";

export type QualityCandidateStatus = "OPEN" | "DISMISSED" | "REPORTED";

export type QualitySourceState = "ACTIVE" | "UPDATED" | "DELETED";

export type QualityNodeStatus =
  | "PENDING_ACCEPTANCE"
  | "IN_PROGRESS"
  | "PENDING_PARENT_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "CANCELLED";

export type QualityAssigneeKind = "MANAGER" | "EMPLOYEE";

export interface QualityAssignmentNode {
  nodeId: string;
  eventId: string;
  parentNodeId: string | null;
  depth: number;
  assigneeUserId: string;
  assigneeKind: QualityAssigneeKind;
  departmentName: string;
  isPrimary: boolean;
  status: QualityNodeStatus;
  dueAt: string;
  requirement: string;
  version: number;
  createdBy: string;
  requestId: string;
  acceptedAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QualityTaskLink {
  nodeId: string;
  taskId: string;
  /** 根节点可只关联父任务；执行节点关联具体子任务。 */
  subtaskId: string | null;
  integrationKey: string;
  createdAt: string;
}

export interface QualityNodeReview {
  reviewId: string;
  eventId: string;
  nodeId: string;
  reviewerUserId: string;
  decision: "APPROVE" | "RETURN";
  reason: string | null;
  evidenceVersion: number | null;
  requestId: string;
  createdAt: string;
}

export interface QualityEvidenceRecord {
  evidenceId: string;
  eventId: string;
  nodeId: string;
  evidenceVersion: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  summary: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  requestId: string;
  createdAt: string;
}

export type QualityAuditActorRole =
  | "aftersales_manager"
  | "quality_specialist"
  | "quality_management"
  | "quality_report"
  | "department_manager"
  | "executor"
  | "system";

export interface QualityEventRecord {
  eventId: string;
  eventNo: string;
  isTest: boolean;
  status: QualityEventStatus;
  title: string;
  problemStatus: string;
  occurredAt: string | null;
  feedbackAt: string | null;
  feedbackUserId: string | null;
  feedbackName: string | null;
  deviceModel: string | null;
  deviceSerial: string | null;
  catheterBatch: string | null;
  clinicianAware: string | null;
  impact: string | null;
  initialCategory: string | null;
  urgency: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null;
  supplement: string | null;
  createdBy: string;
  submittedBy: string | null;
  submittedAt: string | null;
  originalPrimaryDepartmentId: string | null;
  overallDueAt: string | null;
  primaryNodeId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface QualitySourceSnapshot {
  sourceKey: string;
  sourceVersion: number;
  sourceState: QualitySourceState;
  snapshot: Record<string, unknown>;
}

export interface QualityAuditEvent {
  id: string;
  eventId: string;
  actorUserId: string;
  actorRole: QualityAuditActorRole;
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  reason: string | null;
  requestId: string;
  occurredAt: string;
}

export interface CreateQualityDraftInput {
  eventId: string;
  eventNo: string;
  actorUserId: string;
  actorRole: QualityAuditActorRole;
  requestId: string;
  title: string;
  problemStatus: string;
  occurredAt?: string | null;
  feedbackAt?: string | null;
  feedbackUserId?: string | null;
  feedbackName?: string | null;
  deviceModel?: string | null;
  deviceSerial?: string | null;
  catheterBatch?: string | null;
  clinicianAware?: string | null;
  impact?: string | null;
  initialCategory?: string | null;
  urgency?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | null;
  supplement?: string | null;
}

export type QualityDraftPatch = Partial<Pick<QualityEventRecord,
  | "title"
  | "problemStatus"
  | "occurredAt"
  | "feedbackAt"
  | "feedbackUserId"
  | "feedbackName"
  | "deviceModel"
  | "deviceSerial"
  | "catheterBatch"
  | "clinicianAware"
  | "impact"
  | "initialCategory"
  | "urgency"
  | "supplement"
>>;
