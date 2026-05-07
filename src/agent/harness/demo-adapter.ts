import { Plan } from "../../domain/plan";
import { TaskPlanningDemoResult } from "../demo/pipeline";

export interface ToHarnessPlanDraftRequest {
  id: string;
  initiatorId: string;
  background: string;
  demo: Extract<TaskPlanningDemoResult, { status: "DRAFT_READY" }>;
  createdAt: string;
}

export function toHarnessPlanDraft(
  request: ToHarnessPlanDraftRequest
): Plan {
  const { demo } = request;
  return {
    id: request.id,
    domain: demo.classification.domain,
    subType: demo.classification.subtype,
    background: request.background,
    constraints: demo.questions,
    initiatorId: request.initiatorId,
    status: "DRAFT",
    taskPackages: demo.tasks,
    externalRefs: [],
    createdAt: request.createdAt,
    updatedAt: request.createdAt,
    demoClassification: demo.classification,
    capaAdvisory: demo.capaAdvisory,
  };
}
