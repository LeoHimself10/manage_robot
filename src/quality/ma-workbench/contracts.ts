export type MaScope = "all" | "pending" | "progress" | "closed";
export type MaStage = "AVAILABLE" | "PENDING_ASSESSMENT" | "READY_TO_SUBMIT" | "IN_PROGRESS" | "CLOSED";
export interface MaAttachment {
  id: string; name: string; mimeType: string; sizeBytes: number; category: string;
  downloadUrl: string | null; status: string; version: number;
}
export interface MaAdmission {
  admittedBy: string; admittedAt: string; sourceVersion: number; version: number;
}
export interface MaAssessment {
  version: number; sourceVersion: number; categoryMode: "STANDARD" | "CUSTOM_SECONDARY" | "CUSTOM_FULL";
  primaryCategoryCode: string | null; secondaryCategoryCode: string | null;
  customPrimaryCategoryName: string | null; customSecondaryCategoryName: string | null;
  categoryDisplayName: string; riskLevel: "LOW" | "MEDIUM" | "HIGH";
  conclusion: string; adoptionMode: "MANUAL" | "DIRECT" | "MODIFIED";
  changeReason: string | null; reviewedBy: string; updatedAt: string;
}
export interface MaAiAssessment {
  id: string; sourceVersion: number; createdAt: string;
  primaryCategoryCode: string; secondaryCategoryCode: string; riskLevel: "LOW" | "MEDIUM" | "HIGH";
  reasoningBasis: Array<{ statement: string; citationIds: string[] }>;
  similarCases: Array<Record<string, unknown>>; missingInformation: unknown[];
  uncertainties: unknown[]; provenance: Record<string, unknown>;
}
export interface MaFeedback {
  sourceKey: string; feedbackNo: string; title: string; reporter: string; submittedAt: string;
  sourceType: "DINGTALK_OA" | "WORKBOOK"; sourceVersion: number; sourceState: string;
  oaStatus: string | null; oaUrl: string | null; stage: MaStage; stageLabel: string;
  deviceModel: string; serialNo: string; catheterBatch: string; riskLevel: string | null;
  admission: MaAdmission | null; event: { id: string; eventNo: string; status: string } | null;
  attachmentCount: number; updatedAt: string; canAdmit: boolean;
}
export interface MaEvidence extends MaAttachment {
  nodeId: string; uploader: string; createdAt: string; summary: string;
}
export interface MaTask {
  taskId: string; taskNo: string; subtaskId: string; title: string; objective: string;
  deliverables: string; completionCriteria: string; assignee: string; assigneeUserId: string;
  manager: string; managerUserId: string; department: string; status: string; statusLabel: string;
  dueAt: string | null; progressNote: string; acceptedAt: string | null; completedAt: string | null;
  evidence: MaEvidence[];
  reviews: Array<{ reviewer: string; decision: string; reason: string; createdAt: string }>;
}
export interface MaDownstream {
  readonly: true;
  analysisVersions: Array<{ version: number; confirmedAt: string; confirmedBy: string; department: string; manager: string; content: Record<string, unknown>; deliverables: unknown[]; dueAt: string | null }>;
  handoffs: Array<{ version: number; department: string; manager: string; status: string; createdAt: string; publishedAt: string | null }>;
  tasks: MaTask[]; evidence: MaEvidence[];
  reviews: Array<{ nodeId: string; reviewer: string; decision: string; reason: string; createdAt: string }>;
  timeline: Array<{ id: string; action: string; actor: string; at: string; reason: string | null }>;
}
export interface MaFeedbackDetail extends MaFeedback {
  rawFields: Array<{ label: string; value: string }>;
  attachments: MaAttachment[]; assessment: MaAssessment | null; aiAssessment: MaAiAssessment | null;
  assessmentHistory: MaAssessment[]; aiHistory: MaAiAssessment[];
  sourceUpdatedSinceAdmission: boolean; sourceUpdatedSinceAssessment: boolean;
  canAssess: boolean; canSubmit: boolean; downstream: MaDownstream | null;
  oaHistory?: {
    versions: Array<{ version: number; createdAt: string; fields: Array<{ label: string; value: string }>; attachments: MaAttachment[] }>;
    approvalHistory: Array<{ id: string; status: string; at: string; records: unknown[] }>;
  };
}
export interface MaFeedbackList {
  items: MaFeedback[]; counts: Record<MaScope, number>;
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  integration?: { connected: boolean; configured: boolean; enabled: boolean; message: string };
}
export interface MaVersionRequest { requestId: string; expectedSourceVersion: number }
export interface MaAssessmentRequest extends MaVersionRequest {
  expectedVersion: number; categoryMode?: "STANDARD" | "CUSTOM_SECONDARY" | "CUSTOM_FULL";
  primaryCategoryCode?: string | null; secondaryCategoryCode?: string | null;
  customPrimaryCategoryName?: string | null; customSecondaryCategoryName?: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH"; conclusion: string;
  adoptionMode: "MANUAL" | "DIRECT" | "MODIFIED"; changeReason?: string | null;
}
export interface MaSubmitRequest extends MaVersionRequest { expectedAssessmentVersion: number }
// API responses: {ok:true,data:MaFeedbackList|MaFeedbackDetail}; failures {ok:false,error,code}.
// GET /api/workbench/quality/ma/feedbacks?scope=all|pending|progress|closed&q=&page=&pageSize=
// GET /api/workbench/quality/ma/feedbacks/:encodeURIComponent(sourceKey)
// POST .../:key/admit or /ai: MaVersionRequest; /assessment: MaAssessmentRequest; /submit: MaSubmitRequest.
// All successful mutations return the complete updated MaFeedbackDetail.
