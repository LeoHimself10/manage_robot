import { Plan } from "../../domain/plan";
import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { TaskPlanningDemoResult } from "../demo/pipeline";

export interface ToHarnessPlanDraftRequest {
  id: string;
  initiatorId: string;
  background: string;
  demo: Extract<TaskPlanningDemoResult, { status: "DRAFT_READY" }>;
  createdAt: string;
}

function cloneTaskPackage(task: TaskPackage): TaskPackage {
  return {
    ...task,
    collaborators: [...task.collaborators],
    inputMaterials: [...task.inputMaterials],
    actions: [...task.actions],
    deliverables: [...task.deliverables],
    completionCriteria: [...task.completionCriteria],
    timeNode: {
      ...task.timeNode,
      checkpoints: [...task.timeNode.checkpoints],
    },
    risksAndOpenQuestions: [...task.risksAndOpenQuestions],
    traceInfo: task.traceInfo ? [...task.traceInfo] : undefined,
    dependencyTaskIds: [...task.dependencyTaskIds],
  };
}

function cloneClassification(
  classification: ClassificationResult
): ClassificationResult {
  return {
    ...classification,
    rationale: [...classification.rationale],
    missingInformation: [...classification.missingInformation],
  };
}

function cloneCapaAdvisory(
  capaAdvisory: CapaAdvisory | undefined
): CapaAdvisory | undefined {
  if (!capaAdvisory) return undefined;

  return {
    ...capaAdvisory,
    rationale: [...capaAdvisory.rationale],
    promptingQuestions: [...capaAdvisory.promptingQuestions],
  };
}

export function toHarnessPlanDraft(
  request: ToHarnessPlanDraftRequest
): Plan {
  const { demo } = request;
  const classification = cloneClassification(demo.classification);
  return {
    id: request.id,
    domain: demo.classification.domain,
    subType: demo.classification.subtype,
    background: request.background,
    constraints: [...demo.questions],
    initiatorId: request.initiatorId,
    status: "DRAFT",
    taskPackages: demo.tasks.map(cloneTaskPackage),
    externalRefs: [],
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    demoClassification: classification,
    capaAdvisory: cloneCapaAdvisory(demo.capaAdvisory),
  };
}
