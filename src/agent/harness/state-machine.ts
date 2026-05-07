import { PlanStatus, PlanEventType } from "./types";

type TransitionMap = Record<PlanStatus, Partial<Record<PlanEventType, PlanStatus>>>;

const transitions: TransitionMap = {
  DRAFT: {
    SUBMIT_FOR_REVIEW: "IN_REVIEW",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  IN_REVIEW: {
    GATE_FAILED: "BLOCKED_BY_GATE",
    GATE_PASSED: "DISPATCHED",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  BLOCKED_BY_GATE: {
    SUBMIT_FOR_REVIEW: "IN_REVIEW",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  DISPATCHED: {
    ASSIGNEE_REQUEST_CHANGES: "NEGOTIATING",
    ASSIGNEE_REJECTED: "NEGOTIATING",
    ASSIGNEE_ACCEPTED: "IN_EXECUTION",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  NEGOTIATING: {
    CHANGES_MERGED: "IN_REVIEW",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  IN_EXECUTION: {
    SUBMIT_FOR_ACCEPTANCE: "IN_ACCEPTANCE",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  IN_ACCEPTANCE: {
    ACCEPTED: "DONE",
    REJECTED_AT_ACCEPTANCE: "IN_EXECUTION",
    CLOSE_WITH_RISK: "CLOSED_WITH_RISK",
  },
  DONE: {},
  CLOSED_WITH_RISK: {},
};

export function getNextStatus(
  currentStatus: PlanStatus,
  eventType: PlanEventType
): PlanStatus {
  const next = transitions[currentStatus][eventType];
  if (!next) {
    throw new Error(
      `invalid transition: ${currentStatus} --${eventType}--> (none)`
    );
  }
  return next;
}

