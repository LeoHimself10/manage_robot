import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { adviseCapa } from "./capa-advisor";
import { classifyTask } from "./classifier";
import { DemoGateResult, validateDemoGate } from "./gate";
import { checkInputQuality } from "./input-qc";
import { renderPlanDraftMarkdown } from "./markdown-renderer";
import { generateWbs } from "./wbs-generator";

export interface TaskPlanningDemoRequest {
  domainHint?: PlanDomain;
  background: string;
}

export type TaskPlanningDemoResult =
  | {
      status: "NEEDS_MORE_INFO";
      questions: string[];
      missingFields: string[];
      markdown?: undefined;
      classification?: undefined;
      capaAdvisory?: undefined;
      tasks?: undefined;
      gate?: undefined;
    }
  | {
      status: "DRAFT_READY";
      questions: string[];
      missingFields: string[];
      classification: ClassificationResult;
      capaAdvisory?: CapaAdvisory;
      tasks: TaskPackage[];
      gate: DemoGateResult;
      markdown: string;
    };

export function createTaskPlanningDemo(
  request: TaskPlanningDemoRequest
): TaskPlanningDemoResult {
  const inputQuality = checkInputQuality(request);

  if (!inputQuality.canGenerateWbs) {
    return {
      status: "NEEDS_MORE_INFO",
      questions: inputQuality.questions,
      missingFields: inputQuality.missingFields,
    };
  }

  const classification = classifyTask({
    background: request.background,
    domainHint: request.domainHint,
  });
  const capaAdvisory =
    classification.domain === "QUALITY"
      ? adviseCapa({
          domain: classification.domain,
          subtype: classification.subtype,
          background: request.background,
        })
      : undefined;
  const tasks = generateWbs({
    classification,
    background: request.background,
  });
  const gate = validateDemoGate(tasks);
  const openQuestions = [
    ...inputQuality.questions,
    ...classification.missingInformation,
    ...(capaAdvisory?.promptingQuestions ?? []),
  ];
  const markdown = renderPlanDraftMarkdown({
    summary: request.background.trim(),
    classification,
    capaAdvisory,
    tasks,
    gate,
    openQuestions,
  });

  return {
    status: "DRAFT_READY",
    questions: openQuestions,
    missingFields: inputQuality.missingFields,
    classification,
    capaAdvisory,
    tasks,
    gate,
    markdown,
  };
}
