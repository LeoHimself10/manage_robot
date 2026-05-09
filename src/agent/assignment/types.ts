export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export interface AssignmentRiskFlag {
  type: "OVERLOAD" | "MISSING_PERMISSION" | "CROSS_DEPARTMENT" | "RECENT_REJECTION" | "INSUFFICIENT_EVIDENCE" | "OTHER";
  description: string;
}

export interface AssignmentCandidate {
  userId: string;
  displayName: string;
  rationale: string;
  evidenceRefs?: string[];
  risks?: AssignmentRiskFlag[];
}

export interface SubTaskAssignment {
  taskId: string;
  primary: AssignmentCandidate;
  alternates: AssignmentCandidate[];
  confidence: Confidence;
  confidenceReason: string;
  managerQuestions?: string[];
  modelSelfCritique?: string;
}

export interface AssignmentDraft {
  planId: string;
  traceId: string;
  generatedAt: string;
  promptVersion: string;
  modelName: string;
  assignments: SubTaskAssignment[];
  globalRisks?: AssignmentRiskFlag[];
}
