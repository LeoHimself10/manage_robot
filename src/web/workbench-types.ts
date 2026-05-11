import type { ConversationSessionState } from "../infra/plan-session-store";

export type WorkbenchRole = "manager" | "employee";

export type WorkbenchStage =
  | "DRAFT"
  | "ASSIGNMENT"
  | "DISPATCHED"
  | "EXECUTION"
  | "ACCEPTANCE"
  | "DONE";

export type WorkbenchSubtaskStatus =
  | "TODO"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "DONE";

export interface WorkbenchUser {
  userId: string;
  displayName?: string;
  role: WorkbenchRole;
}

export interface WorkbenchTaskSummary {
  planId: string;
  traceId?: string;
  title: string;
  stage: WorkbenchStage;
  ownerUserId?: string;
  updatedAt?: string;
}

export interface WorkbenchSubtaskProgress {
  taskId: string;
  title: string;
  assigneeUserId?: string;
  status: WorkbenchSubtaskStatus;
  note?: string;
  updatedAt?: string;
}

export interface WorkbenchTaskDetail extends WorkbenchTaskSummary {
  subtasks: WorkbenchSubtaskProgress[];
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
}

export interface WorkbenchTaskQuery {
  keyword?: string;
  stage?: WorkbenchStage;
  ownerUserId?: string;
}

export interface WorkbenchInProgressSession {
  planId: string;
  conversationId: string;
  stage: ConversationSessionState["stage"];
  updatedAt?: string;
  managerUserId?: string;
  employeeUserId?: string;
  title: string;
}
