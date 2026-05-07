import { AssignmentStatus } from "../agent/harness/types";

export interface Assignment {
  id: string;
  planId: string;
  assigneeId: string;
  collaborators: string[];
  status: AssignmentStatus;
  changeRequestReason?: string;
  rejectReason?: string;
  suggestedReplacementId?: string;
  updatedAt: string;
}

