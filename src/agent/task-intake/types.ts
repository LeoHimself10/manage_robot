export interface TaskIntakeSubtask {
  title: string;
  objective?: string;
  deliverables?: string;
  completionCriteria?: string;
  actions?: string;
  dependsOn?: string;
  dueAt?: string;
  dueMode?: "fixed" | "self";
  dueExpectation?: string;
  assigneeName?: string;
}

export interface TaskIntakeStructured {
  parentTitle: string;
  parentDescription: string;
  subtasks: TaskIntakeSubtask[];
}

export interface TaskIntakePreviewRow {
  itemId: string;
  selected: boolean;
  title: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  actions: string;
  dependsOn: string;
  dueAt?: string;
  dueMode?: "fixed" | "self";
  dueExpectation?: string;
  assigneeUserId?: string;
  assigneeDisplayName?: string;
  assigneeNameRaw?: string;
  needsConfirm: boolean;
  /** AI-suggested target: planId of an existing task. Mutually exclusive with suggestedNewGroupId. */
  suggestedTargetPlanId?: string;
  suggestedTargetTitle?: string;
  suggestedTargetNo?: string;
  /** AI-suggested new parent group ID (e.g. "ng_1"). Mutually exclusive with suggestedTargetPlanId. */
  suggestedNewGroupId?: string;
  suggestedNewGroupTitle?: string;
  suggestedNewGroupDescription?: string;
  /** 0–1; <0.6 means "unassigned" */
  suggestedConfidence?: number;
  suggestedReason?: string;
}

export interface TaskIntakeCommitRow {
  itemId: string;
  selected: boolean;
  title: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  actions: string;
  dependsOn: string;
  dueAt?: string;
  dueMode?: "fixed" | "self";
  dueExpectation?: string;
  assigneeUserId: string;
  /** If set, append to this existing task instead of creating a new parent. */
  targetPlanId?: string;
}

export type TaskIntakeCommitMode = "published" | "staged" | "empty" | "invalid" | "appended";

export interface TaskIntakeCommitResult {
  mode: TaskIntakeCommitMode;
  subtaskCount: number;
  task?: { taskNo: string; title: string; planId: string };
  stagedDeepLink?: string;
  errors: Array<{ itemId: string; message: string }>;
}

export interface TaskIntakeAppendInput {
  targetPlanId: string;
  managerUserId: string;
  rows: TaskIntakeCommitRow[];
  actorName?: string;
}

export interface TaskIntakeAppendResult {
  mode: "appended" | "empty" | "invalid";
  appendedCount: number;
  targetTask?: { taskNo: string; title: string; planId: string };
  errors: Array<{ itemId: string; message: string }>;
}
