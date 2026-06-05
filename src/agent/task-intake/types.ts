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
}

export type TaskIntakeCommitMode = "published" | "staged" | "empty" | "invalid";

export interface TaskIntakeCommitResult {
  mode: TaskIntakeCommitMode;
  subtaskCount: number;
  task?: { taskNo: string; title: string; planId: string };
  stagedDeepLink?: string;
  errors: Array<{ itemId: string; message: string }>;
}
