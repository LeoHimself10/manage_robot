import { Assignment } from "../../domain/assignment";

export function confirmAssignment(assignment: Assignment): Assignment {
  return {
    ...assignment,
    status: "ACCEPTED",
    updatedAt: new Date().toISOString(),
  };
}

export function requestAssignmentChanges(
  assignment: Assignment,
  reason: string
): Assignment {
  return {
    ...assignment,
    status: "REQUEST_CHANGES",
    changeRequestReason: reason,
    updatedAt: new Date().toISOString(),
  };
}

export function rejectAssignment(
  assignment: Assignment,
  reason: string,
  suggestedReplacementId?: string
): Assignment {
  return {
    ...assignment,
    status: "REJECTED",
    rejectReason: reason,
    suggestedReplacementId,
    updatedAt: new Date().toISOString(),
  };
}

