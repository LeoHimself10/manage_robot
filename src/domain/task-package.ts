export interface TimeNode {
  startAt?: string;
  checkpoints: string[];
  dueAt: string;
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
}

