export type MeetingImportRelationKind =
  | "duplicate"
  | "contained"
  | "superset"
  | "similar"
  | "none";

export interface MeetingImportActionItem {
  id: string;
  title: string;
  excerpt: string;
  assigneeName?: string;
  dueAt?: string;
  rawSection?: string;
}

export interface MeetingImportProjectSuggestion {
  projectId?: string;
  projectName: string;
  confidence: "high" | "medium" | "low";
  reason: string;
  alternatives: Array<{ projectId: string; projectName: string; reason: string }>;
}

export type MeetingImportParentKind = "existing" | "new";

export interface MeetingImportParentSuggestion {
  kind: MeetingImportParentKind;
  taskNo?: string;
  planId?: string;
  existingTaskTitle?: string;
  suggestedTitle?: string;
  themeKey?: string;
  reason?: string;
}

export interface MeetingImportPreviewRow {
  itemId: string;
  selected: boolean;
  title: string;
  excerpt: string;
  relationKind: MeetingImportRelationKind;
  relationReason: string;
  existingTaskNo?: string;
  existingSubtaskId?: string;
  existingSubtaskTitle?: string;
  projectId: string;
  projectName: string;
  parent: MeetingImportParentSuggestion;
  assigneeUserId?: string;
  assigneeDisplayName?: string;
  assigneeNameRaw?: string;
  dueAt?: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  manuallyEdited?: boolean;
  aiReason?: string;
}

export interface MeetingImportCommitRow {
  itemId: string;
  selected: boolean;
  title: string;
  excerpt: string;
  projectId: string;
  parentKind: MeetingImportParentKind;
  planId?: string;
  taskNo?: string;
  newParentTitle?: string;
  themeKey?: string;
  assigneeUserId: string;
  dueAt?: string;
  objective: string;
  deliverables: string;
  completionCriteria: string;
  manuallyEdited?: boolean;
}

export interface MeetingImportCommitResult {
  batchId: string;
  createdTasks: Array<{ taskNo: string; title: string; planId: string; subtaskCount: number }>;
  appendedSubtasks: Array<{ taskNo: string; subtaskTitle: string; subtaskId: string }>;
  skipped: string[];
  errors: Array<{ itemId: string; message: string }>;
}
