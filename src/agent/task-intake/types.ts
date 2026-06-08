export interface TaskIntakeSubtask {
  title: string;
  objective?: string;
  deliverables?: string;
  completionCriteria?: string;
  actions?: string;
  dependsOn?: string;
  dueAt?: string;
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
  assigneeUserId?: string;
  assigneeDisplayName?: string;
  assigneeNameRaw?: string;
  needsConfirm: boolean;
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
