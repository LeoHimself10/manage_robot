export type PlanDomain = "QUALITY" | "RD";

export type PlanStatus =
  | "DRAFT"
  | "IN_REVIEW"
  | "BLOCKED_BY_GATE"
  | "DISPATCHED"
  | "NEGOTIATING"
  | "IN_EXECUTION"
  | "IN_ACCEPTANCE"
  | "DONE"
  | "CLOSED_WITH_RISK";

export type AssignmentStatus =
  | "PENDING_CONFIRM"
  | "ACCEPTED"
  | "REQUEST_CHANGES"
  | "REJECTED"
  | "TIMEOUT_REMIND_SENT"
  | "TIMEOUT_ESCALATED";

export type PlanEventType =
  | "GENERATE_DRAFT"
  | "SUBMIT_FOR_REVIEW"
  | "GATE_FAILED"
  | "GATE_PASSED"
  | "DISPATCHED"
  | "ASSIGNEE_ACCEPTED"
  | "ASSIGNEE_REQUEST_CHANGES"
  | "ASSIGNEE_REJECTED"
  | "CHANGES_MERGED"
  | "START_EXECUTION"
  | "SUBMIT_FOR_ACCEPTANCE"
  | "ACCEPTED"
  | "REJECTED_AT_ACCEPTANCE"
  | "CLOSE_WITH_RISK";

export interface PlanEvent {
  type: PlanEventType;
  planId: string;
  actorId: string;
  occurredAt: string;
  payload?: Record<string, unknown>;
}

export interface GuardResult {
  passed: boolean;
  reason?: string;
}

