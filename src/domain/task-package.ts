export interface TimeNode {
  startAt?: string;
  checkpoints: string[];
  dueAt: string;
}

export interface TaskScope {
  inScope: string[];
  outOfScope: string[];
}

export interface TaskPackage {
  id: string;
  title: string;
  objective: string;
  /** @deprecated use scope instead; kept for backwards compat */
  scopeBoundary?: string;
  /** Range boundary for the task: what is in-scope and out-of-scope. */
  scope?: TaskScope;
  ownerId?: string;
  collaborators: string[];
  inputMaterials: string[];
  actions: string[];
  deliverables: string[];
  completionCriteria: string[];
  timeNode: TimeNode;
  feedbackFrequency: string;
  acceptanceBy?: string;
  risksAndOpenQuestions: string[];
  traceInfo?: string[];
  dependencyTaskIds: string[];
}

