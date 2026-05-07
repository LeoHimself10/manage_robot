import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { getTaskSkeletons } from "./templates";

export interface GenerateWbsRequest {
  classification: ClassificationResult;
  background: string;
}

export function generateWbs(request: GenerateWbsRequest): TaskPackage[] {
  return getTaskSkeletons(request.classification.subtype).map((skeleton, index) => ({
    id: `task_${index + 1}`,
    title: skeleton.title,
    objective: skeleton.objective,
    collaborators: [],
    inputMaterials: [request.background],
    actions: [...skeleton.actions],
    deliverables: [...skeleton.deliverables],
    completionCriteria: [...skeleton.completionCriteria],
    timeNode: {
      checkpoints: [...skeleton.checkpoints],
      dueAt: skeleton.dueAt,
    },
    feedbackFrequency: skeleton.feedbackFrequency,
    risksAndOpenQuestions: [],
    traceInfo: request.classification.domain === "RD" ? ["待关联需求/风险 ID"] : undefined,
    dependencyTaskIds: index === 0 ? [] : [`task_${index}`],
  }));
}
