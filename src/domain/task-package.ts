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
  scopeBoundary?: string;
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
  /** 范围边界：做什么 / 不做什么 */
  scope?: TaskScope;
}
