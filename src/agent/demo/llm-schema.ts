import { CapaAdvisoryValue } from "../../domain/capa";
import {
  ClassificationConfidence,
  TaskSubtype,
} from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { LlmPlanPayload } from "./llm-types";

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ValidateLlmPlanPayloadOptions {
  /** When model signals NEEDS_MORE_INFO (LOW + questions), tasks may be empty. */
  allowEmptyTasks?: boolean;
}

export function needsMoreInfoFromLlmPayload(payload: LlmPlanPayload): boolean {
  return (
    payload.classification.confidence === "LOW" &&
    (payload.classification.missingInformation.length > 0 ||
      payload.openQuestions.length > 0)
  );
}

const classificationConfidenceValues = new Set<ClassificationConfidence>([
  "HIGH",
  "MEDIUM",
  "LOW",
]);

const domainValues = new Set<PlanDomain>(["QUALITY", "RD"]);

const capaValues = new Set<CapaAdvisoryValue>([
  "NOT_REQUIRED",
  "RECOMMENDED",
  "UNCERTAIN",
  "INSUFFICIENT_INFO",
]);

const subtypeValues = new Set<TaskSubtype>([
  "PRODUCTION_PROCESS_ABNORMALITY",
  "INSPECTION_OR_TEST_ABNORMALITY",
  "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
  "SUPPLIER_ISSUE",
  "DESIGN_RELATED_QUALITY_TASK",
  "QUALITY_OTHER_OR_UNCERTAIN",
  "REQUIREMENT_OR_DESIGN_INPUT",
  "SOLUTION_DEVELOPMENT",
  "VERIFICATION_AND_VALIDATION",
  "DESIGN_CHANGE_ACTION",
  "RD_OTHER_OR_UNCERTAIN",
]);

export function validateLlmPlanPayload(
  payload: unknown,
  options?: ValidateLlmPlanPayloadOptions
): ValidationResult {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["payload must be an object"] };
  }

  const candidate = payload as Record<string, unknown>;
  const classification = candidate.classification as Record<string, unknown> | undefined;
  let domainForCapa: PlanDomain | undefined;
  if (!classification || typeof classification !== "object") {
    errors.push("classification is required");
  } else {
    if (!domainValues.has(classification.domain as PlanDomain)) {
      errors.push("classification.domain is invalid");
    }
    if (!subtypeValues.has(classification.subtype as TaskSubtype)) {
      errors.push("classification.subtype is invalid");
    }
    if (
      !classificationConfidenceValues.has(
        classification.confidence as ClassificationConfidence
      )
    ) {
      errors.push("classification.confidence is invalid");
    }
    if (!isStringArray(classification.rationale)) {
      errors.push("classification.rationale must be string[]");
    }
    if (!isStringArray(classification.missingInformation)) {
      errors.push("classification.missingInformation must be string[]");
    }
    if (domainValues.has(classification.domain as PlanDomain)) {
      domainForCapa = classification.domain as PlanDomain;
    }
  }

  const tasks = candidate.tasks;
  if (!Array.isArray(tasks)) {
    errors.push("tasks must be an array");
  } else if (tasks.length === 0 && !options?.allowEmptyTasks) {
    errors.push("tasks must contain at least one task");
  } else {
    tasks.forEach((task, index) => {
      validateTask(task, index, errors);
    });
  }

  if (!isStringArray(candidate.openQuestions)) {
    errors.push("openQuestions must be string[]");
  }

  if (candidate.gateSelfCheck !== undefined) {
    validateGateSelfCheck(candidate.gateSelfCheck, errors);
  }

  if (domainForCapa === "QUALITY") {
    if (candidate.capaAdvisory === undefined || candidate.capaAdvisory === null) {
      errors.push("capaAdvisory is required when classification.domain is QUALITY");
    } else {
      validateCapa(candidate.capaAdvisory, errors);
    }
  } else if (domainForCapa === "RD") {
    if (candidate.capaAdvisory !== undefined && candidate.capaAdvisory !== null) {
      errors.push("capaAdvisory must be absent when classification.domain is RD");
    }
  } else if (candidate.capaAdvisory !== undefined) {
    validateCapa(candidate.capaAdvisory, errors);
  }

  return { valid: errors.length === 0, errors };
}

export function coerceLlmPlanPayload(
  payload: unknown,
  context?: {
    domainHint?: PlanDomain;
    background?: string;
  }
): LlmPlanPayload {
  const candidate = payload as Record<string, unknown>;
  const classification = normalizeClassification(candidate, context);
  const openQuestions = normalizeStringArray(candidate.openQuestions);
  const capaAdvisory =
    classification.domain === "QUALITY"
      ? normalizeCapaAdvisory(candidate.capaAdvisory, openQuestions)
      : undefined;
  const tasks = normalizeTasks(candidate.tasks);

  return {
    classification,
    capaAdvisory,
    tasks,
    openQuestions,
    gateSelfCheck: normalizeGateSelfCheck(candidate.gateSelfCheck),
  };
}

function validateTask(task: unknown, index: number, errors: string[]): void {
  if (!task || typeof task !== "object") {
    errors.push(`tasks[${index}] must be an object`);
    return;
  }
  const candidate = task as Record<string, unknown>;

  const requiredText = ["id", "title", "objective"] as const;
  requiredText.forEach((field) => {
    if (!isNonEmptyString(candidate[field])) {
      errors.push(`tasks[${index}].${field} must be non-empty string`);
    }
  });

  if (typeof candidate.feedbackFrequency !== "string") {
    errors.push(`tasks[${index}].feedbackFrequency must be string`);
  }

  const requiredArrays = [
    "collaborators",
    "inputMaterials",
    "actions",
    "deliverables",
    "completionCriteria",
    "risksAndOpenQuestions",
    "dependencyTaskIds",
  ] as const;
  requiredArrays.forEach((field) => {
    if (!isStringArray(candidate[field])) {
      errors.push(`tasks[${index}].${field} must be string[]`);
    }
  });

  const timeNode = candidate.timeNode as Record<string, unknown> | undefined;
  if (!timeNode || typeof timeNode !== "object") {
    errors.push(`tasks[${index}].timeNode is required`);
  } else {
    if (!isStringArray(timeNode.checkpoints)) {
      errors.push(`tasks[${index}].timeNode.checkpoints must be string[]`);
    }
    if (typeof timeNode.dueAt !== "string") {
      errors.push(`tasks[${index}].timeNode.dueAt must be string`);
    }
  }
}

function validateCapa(capa: unknown, errors: string[]): void {
  if (!capa || typeof capa !== "object") {
    errors.push("capaAdvisory must be an object");
    return;
  }
  const candidate = capa as Record<string, unknown>;
  if (!capaValues.has(candidate.advisory as CapaAdvisoryValue)) {
    errors.push("capaAdvisory.advisory is invalid");
  }
  if (!isStringArray(candidate.rationale)) {
    errors.push("capaAdvisory.rationale must be string[]");
  }
  if (!isNonEmptyString(candidate.disclaimer)) {
    errors.push("capaAdvisory.disclaimer must be non-empty string");
  }
  if (!isStringArray(candidate.promptingQuestions)) {
    errors.push("capaAdvisory.promptingQuestions must be string[]");
  }
}

function validateGateSelfCheck(selfCheck: unknown, errors: string[]): void {
  if (!selfCheck || typeof selfCheck !== "object") {
    errors.push("gateSelfCheck must be an object");
    return;
  }
  const candidate = selfCheck as Record<string, unknown>;
  if (typeof candidate.passed !== "boolean") {
    errors.push("gateSelfCheck.passed must be boolean");
  }
  const missingByTask = candidate.missingByTask;
  if (!Array.isArray(missingByTask)) {
    errors.push("gateSelfCheck.missingByTask must be an array");
    return;
  }
  missingByTask.forEach((item, index) => {
    if (!item || typeof item !== "object") {
      errors.push(`gateSelfCheck.missingByTask[${index}] must be an object`);
      return;
    }
    const task = item as Record<string, unknown>;
    if (!isNonEmptyString(task.taskId)) {
      errors.push(`gateSelfCheck.missingByTask[${index}].taskId must be non-empty string`);
    }
    if (!isStringArray(task.missingFields)) {
      errors.push(`gateSelfCheck.missingByTask[${index}].missingFields must be string[]`);
    }
  });
}

function isStringArray(input: unknown): input is string[] {
  return Array.isArray(input) && input.every((item) => typeof item === "string");
}

function isNonEmptyString(input: unknown): input is string {
  return typeof input === "string" && input.trim().length > 0;
}

function normalizeClassification(
  candidate: Record<string, unknown>,
  context?: { domainHint?: PlanDomain; background?: string }
): LlmPlanPayload["classification"] {
  const value = candidate.classification;
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const domain = normalizeDomain(raw.domain, context?.domainHint);
    const subtype = normalizeSubtype(raw.subtype, domain, context?.background ?? "");
    const confidence = normalizeConfidence(raw.confidence);
    const rationale = normalizeStringArray(raw.rationale);
    const missingInformation = normalizeStringArray(raw.missingInformation);
    return {
      domain,
      subtype,
      confidence,
      rationale:
        rationale.length > 0
          ? rationale
          : ["模型返回分类缺少判断依据，已使用兼容默认值补全。"],
      missingInformation,
    };
  }

  const domain: PlanDomain = normalizeDomain(value, context?.domainHint);

  const subtype = inferSubtype(domain, context?.background ?? "");
  return {
    domain,
    subtype,
    confidence: "MEDIUM",
    rationale: ["模型返回了简化分类结构，已按兼容策略补全。"],
    missingInformation: [],
  };
}

function inferSubtype(domain: PlanDomain, background: string): TaskSubtype {
  if (domain === "RD") {
    if (/V&V|验证|确认|样本量|通过准则/.test(background)) {
      return "VERIFICATION_AND_VALIDATION";
    }
    if (/变更|ECN/.test(background)) {
      return "DESIGN_CHANGE_ACTION";
    }
    return "RD_OTHER_OR_UNCERTAIN";
  }

  if (/客诉|客户|现场|售后/.test(background)) {
    return "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE";
  }
  if (/检验|测试/.test(background)) {
    return "INSPECTION_OR_TEST_ABNORMALITY";
  }
  return "PRODUCTION_PROCESS_ABNORMALITY";
}

function normalizeDomain(input: unknown, fallback?: PlanDomain): PlanDomain {
  const normalized = asString(input).toUpperCase();
  if (normalized === "RD") return "RD";
  if (normalized === "QUALITY") return "QUALITY";
  return fallback === "RD" ? "RD" : "QUALITY";
}

function normalizeSubtype(
  input: unknown,
  domain: PlanDomain,
  background: string
): TaskSubtype {
  const normalized = asString(input).toUpperCase() as TaskSubtype;
  if (subtypeValues.has(normalized)) return normalized;
  return inferSubtype(domain, background);
}

function normalizeConfidence(input: unknown): ClassificationConfidence {
  const normalized = asString(input).toUpperCase() as ClassificationConfidence;
  if (classificationConfidenceValues.has(normalized)) return normalized;
  return "MEDIUM";
}

function normalizeTasks(input: unknown): TaskPackage[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item, index) => normalizeTask(item, index))
    .filter((task): task is TaskPackage => task !== null);
}

function normalizeTask(input: unknown, index: number): TaskPackage | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Record<string, unknown>;
  const timeNode = candidate.timeNode as Record<string, unknown> | undefined;
  const description = asString(candidate.description);
  const title = asString(candidate.title) || shortText(description) || `任务 ${index + 1}`;
  const objective = asString(candidate.objective) || description || title;
  const dueAt =
    asString(timeNode?.dueAt) ||
    asString(candidate.deadline) ||
    asString(candidate.dueAt);
  const dependencies = normalizeStringArray(candidate.dependencyTaskIds).length
    ? normalizeStringArray(candidate.dependencyTaskIds)
    : normalizeStringArray(candidate.dependencies);
  const owner = asString(candidate.owner);

  return {
    id: asString(candidate.id) || `task_${index + 1}`,
    title,
    objective,
    collaborators: owner ? [owner] : [],
    inputMaterials: normalizeStringArray(candidate.inputMaterials),
    actions: normalizeStringArray(candidate.actions),
    deliverables: normalizeStringArray(candidate.deliverables),
    completionCriteria: normalizeStringArray(candidate.completionCriteria),
    timeNode: {
      checkpoints: normalizeStringArray(timeNode?.checkpoints),
      dueAt,
    },
    feedbackFrequency: asString(candidate.feedbackFrequency),
    risksAndOpenQuestions: normalizeStringArray(candidate.risksAndOpenQuestions),
    dependencyTaskIds: dependencies,
  };
}

function normalizeGateSelfCheck(
  input: unknown
): LlmPlanPayload["gateSelfCheck"] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const candidate = input as Record<string, unknown>;
  return {
    passed: candidate.passed === true,
    missingByTask: Array.isArray(candidate.missingByTask)
      ? candidate.missingByTask
          .map((item) => {
            if (!item || typeof item !== "object") return null;
            const task = item as Record<string, unknown>;
            return {
              taskId: asString(task.taskId),
              title: asString(task.title) || undefined,
              missingFields: normalizeStringArray(task.missingFields),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
  };
}

function normalizeCapaAdvisoryValue(input: unknown): CapaAdvisoryValue {
  const raw = asString(input);
  if (!raw) return "UNCERTAIN";
  const compact = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if (capaValues.has(compact as CapaAdvisoryValue)) {
    return compact as CapaAdvisoryValue;
  }
  if (/RECOMMENDED|建议开启|推荐CAPA|建议CAPA/i.test(raw)) {
    return "RECOMMENDED";
  }
  if (/NOT[_\s]?REQUIRED|不必|不需要|无需CAPA|可不开启/i.test(raw)) {
    return "NOT_REQUIRED";
  }
  if (/INSUFFICIENT|信息不足|资料不足|不足以判断/i.test(raw)) {
    return "INSUFFICIENT_INFO";
  }
  if (/UNCERTAIN|不确定|待评估|尚不明确/i.test(raw)) {
    return "UNCERTAIN";
  }
  return "UNCERTAIN";
}

function normalizeCapaAdvisory(
  input: unknown,
  openQuestions: string[]
): LlmPlanPayload["capaAdvisory"] | undefined {
  if (!input || typeof input !== "object") return undefined;

  const candidate = input as Record<string, unknown>;
  if (isNonEmptyString(candidate.advisory)) {
    return {
      advisory: normalizeCapaAdvisoryValue(candidate.advisory),
      rationale: normalizeStringArray(candidate.rationale),
      disclaimer: asString(candidate.disclaimer),
      promptingQuestions: normalizeStringArray(candidate.promptingQuestions),
    };
  }

  const rationale = [
    ...normalizeStringArray(candidate.immediateContainment),
    ...normalizeStringArray(candidate.correctiveAction),
    ...normalizeStringArray(candidate.preventiveAction),
  ];
  if (rationale.length === 0) return undefined;

  return {
    advisory: "UNCERTAIN",
    rationale,
    disclaimer:
      "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
    promptingQuestions: openQuestions,
  };
}

function normalizeStringArray(input: unknown): string[] {
  if (typeof input === "string" && input.trim().length > 0) {
    return [input.trim()];
  }
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function asString(input: unknown): string {
  return typeof input === "string" ? input.trim() : "";
}

function shortText(text: string): string {
  if (!text) return "";
  return text.length <= 24 ? text : `${text.slice(0, 24)}...`;
}
