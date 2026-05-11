import { CapaAdvisoryValue } from "../../domain/capa";
import {
  ClassificationConfidence,
  TaskSubtype,
} from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { PlanDomain } from "../harness/types";
import { ClarificationUxKind, LlmPlanPayload, ResponseIntent } from "./llm-types";

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

const responseIntentValues = new Set<ResponseIntent>([
  "CHAT",
  "CLARIFY",
  "DISCUSS",
  "DRAFT",
  "REVISE_DRAFT",
  "RESET_OR_NEW_TASK",
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

/** Subtypes allowed when classification.domain is QUALITY */
const qualitySubtypeSet = new Set<string>([
  "PRODUCTION_PROCESS_ABNORMALITY",
  "INSPECTION_OR_TEST_ABNORMALITY",
  "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
  "SUPPLIER_ISSUE",
  "DESIGN_RELATED_QUALITY_TASK",
  "QUALITY_OTHER_OR_UNCERTAIN",
]);

/** Subtypes allowed when classification.domain is RD */
const rdSubtypeSet = new Set<string>([
  "REQUIREMENT_OR_DESIGN_INPUT",
  "SOLUTION_DEVELOPMENT",
  "VERIFICATION_AND_VALIDATION",
  "DESIGN_CHANGE_ACTION",
  "RD_OTHER_OR_UNCERTAIN",
]);

/**
 * Common model variants / typos → canonical TaskSubtype (still validated + domain-checked).
 */
const SUBTYPE_ALIASES: Record<string, TaskSubtype> = {
  V_AND_V: "VERIFICATION_AND_VALIDATION",
  VV: "VERIFICATION_AND_VALIDATION",
  V_V: "VERIFICATION_AND_VALIDATION",
  VERIFICATION_VALIDATION: "VERIFICATION_AND_VALIDATION",
  VNV: "VERIFICATION_AND_VALIDATION",
  REQUIREMENT_INPUT: "REQUIREMENT_OR_DESIGN_INPUT",
  DESIGN_REQUIREMENT: "REQUIREMENT_OR_DESIGN_INPUT",
  REQ_DESIGN_INPUT: "REQUIREMENT_OR_DESIGN_INPUT",
  SOLUTION_DEV: "SOLUTION_DEVELOPMENT",
  SOFTWARE_DEVELOPMENT: "SOLUTION_DEVELOPMENT",
  ECN: "DESIGN_CHANGE_ACTION",
  ENGINEERING_CHANGE: "DESIGN_CHANGE_ACTION",
  DESIGN_CHANGE: "DESIGN_CHANGE_ACTION",
  CHANGE_CONTROL: "DESIGN_CHANGE_ACTION",
  PRODUCTION_ABNORMALITY: "PRODUCTION_PROCESS_ABNORMALITY",
  MANUFACTURING_ABNORMALITY: "PRODUCTION_PROCESS_ABNORMALITY",
  CUSTOMER_COMPLAINT: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
  FIELD_ISSUE: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
  SUPPLIER: "SUPPLIER_ISSUE",
  IQC_ABNORMALITY: "INSPECTION_OR_TEST_ABNORMALITY",
  IPQC_ABNORMALITY: "INSPECTION_OR_TEST_ABNORMALITY",
  OQC_ABNORMALITY: "INSPECTION_OR_TEST_ABNORMALITY",
};

export function validateLlmPlanPayload(
  payload: unknown,
  options?: ValidateLlmPlanPayloadOptions
): ValidationResult {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object") {
    return { valid: false, errors: ["payload must be an object"] };
  }

  const candidate = payload as Record<string, unknown>;
  if (candidate.responseIntent !== undefined) {
    const intent =
      typeof candidate.responseIntent === "string"
        ? candidate.responseIntent.trim().toUpperCase()
        : "";
    if (!responseIntentValues.has(intent as ResponseIntent)) {
      errors.push("responseIntent is invalid");
    }
  }
  if (
    candidate.assistantMessage !== undefined &&
    typeof candidate.assistantMessage !== "string"
  ) {
    errors.push("assistantMessage must be string when present");
  }

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

  if (candidate.clarificationUx !== undefined) {
    if (candidate.clarificationUx !== "NON_TASK" && candidate.clarificationUx !== "TASK_GAP") {
      errors.push("clarificationUx must be NON_TASK or TASK_GAP when present");
    }
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

export function coerceLlmPlanPayload(payload: unknown): LlmPlanPayload {
  const candidate = payload as Record<string, unknown>;
  const classification = normalizeClassification(candidate);
  const openQuestions = normalizeStringArray(candidate.openQuestions);
  const capaAdvisory =
    classification.domain === "QUALITY"
      ? normalizeCapaAdvisory(candidate.capaAdvisory, openQuestions)
      : undefined;
  const tasks = normalizeTasks(candidate.tasks);
  const clarificationUx = normalizeClarificationUx(candidate.clarificationUx);
  const responseIntent = normalizeResponseIntent(
    candidate.responseIntent,
    tasks,
    clarificationUx,
    classification.confidence,
    openQuestions
  );
  const assistantMessage = normalizeAssistantMessage(
    candidate.assistantMessage,
    openQuestions
  );

  return {
    responseIntent,
    assistantMessage,
    classification,
    capaAdvisory,
    tasks,
    openQuestions,
    gateSelfCheck: normalizeGateSelfCheck(candidate.gateSelfCheck),
    clarificationUx,
  };
}

function normalizeResponseIntent(
  raw: unknown,
  tasks: TaskPackage[],
  clarificationUx: ClarificationUxKind | undefined,
  confidence: ClassificationConfidence,
  openQuestions: string[]
): ResponseIntent {
  if (raw !== undefined && raw !== null && typeof raw !== "string") {
    return String(raw).trim().toUpperCase() as ResponseIntent;
  }
  const explicit = asString(raw).toUpperCase();
  if (responseIntentValues.has(explicit as ResponseIntent)) {
    return explicit as ResponseIntent;
  }
  if (explicit) return explicit as ResponseIntent;
  if (tasks.length > 0) return "DRAFT";
  if (clarificationUx === "NON_TASK") return "CHAT";
  if (confidence === "LOW" || openQuestions.length > 0) return "CLARIFY";
  return "DRAFT";
}

function normalizeAssistantMessage(raw: unknown, openQuestions: string[]): string {
  const explicit = asString(raw);
  if (explicit) return explicit;
  return openQuestions[0] ?? "";
}

function normalizeClarificationUx(raw: unknown): ClarificationUxKind | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "NON_TASK" || s === "TASK_GAP") return s;
  return undefined;
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
  candidate: Record<string, unknown>
): LlmPlanPayload["classification"] {
  const value = candidate.classification;
  if (!value || typeof value !== "object") {
    return {
      domain: "" as PlanDomain,
      subtype: "" as TaskSubtype,
      confidence: "" as ClassificationConfidence,
      rationale: [],
      missingInformation: [],
    };
  }
  const raw = value as Record<string, unknown>;
  const domain = normalizeDomain(raw.domain);
  return {
    domain,
    subtype: normalizeSubtype(raw.subtype, domain),
    confidence: normalizeConfidence(raw.confidence),
    rationale: normalizeStringArray(raw.rationale),
    missingInformation: normalizeStringArray(raw.missingInformation),
  };
}

function normalizeDomain(input: unknown): PlanDomain {
  const normalized = asString(input).toUpperCase();
  if (normalized === "RD") return "RD";
  if (normalized === "QUALITY") return "QUALITY";
  return normalized as PlanDomain;
}

function normalizeSubtypeKey(input: unknown): string {
  const raw = asString(input);
  if (!raw) return "";
  return raw
    .toUpperCase()
    .replace(/&/g, "AND")
    .replace(/[\s./-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function ensureSubtypeForDomain(subtype: TaskSubtype, domain: PlanDomain): TaskSubtype {
  if (!domainValues.has(domain)) {
    return "QUALITY_OTHER_OR_UNCERTAIN";
  }
  if (domain === "QUALITY" && qualitySubtypeSet.has(subtype)) return subtype;
  if (domain === "RD" && rdSubtypeSet.has(subtype)) return subtype;
  if (domain === "QUALITY") return "QUALITY_OTHER_OR_UNCERTAIN";
  return "RD_OTHER_OR_UNCERTAIN";
}

function inferSubtypeFromFuzzyKey(key: string): TaskSubtype | undefined {
  if (!key) return undefined;
  if (key.includes("VERIFICATION") && key.includes("VALIDATION")) {
    return "VERIFICATION_AND_VALIDATION";
  }
  if (key.includes("SOLUTION") && key.includes("DEVELOPMENT")) {
    return "SOLUTION_DEVELOPMENT";
  }
  if (key.includes("REQUIREMENT") && key.includes("DESIGN")) {
    return "REQUIREMENT_OR_DESIGN_INPUT";
  }
  if (key.includes("DESIGN") && key.includes("CHANGE")) {
    return "DESIGN_CHANGE_ACTION";
  }
  if (key.includes("CUSTOMER") || key.includes("COMPLAINT") || key.includes("FIELD")) {
    return "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE";
  }
  if (key.includes("PRODUCTION") || key.includes("MANUFACTURING")) {
    return "PRODUCTION_PROCESS_ABNORMALITY";
  }
  if (key.includes("SUPPLIER")) {
    return "SUPPLIER_ISSUE";
  }
  if (
    key.includes("INSPECTION") ||
    key.includes("IPQC") ||
    key.includes("OQC") ||
    key.includes("IQC")
  ) {
    return "INSPECTION_OR_TEST_ABNORMALITY";
  }
  return undefined;
}

function normalizeSubtype(input: unknown, domain: PlanDomain): TaskSubtype {
  const key = normalizeSubtypeKey(input);
  const fromAlias = key ? SUBTYPE_ALIASES[key] : undefined;
  if (fromAlias) {
    return ensureSubtypeForDomain(fromAlias, domain);
  }
  if (key && subtypeValues.has(key as TaskSubtype)) {
    return ensureSubtypeForDomain(key as TaskSubtype, domain);
  }
  const fuzzy = key ? inferSubtypeFromFuzzyKey(key) : undefined;
  if (fuzzy) {
    return ensureSubtypeForDomain(fuzzy, domain);
  }
  if (domain === "RD") return "RD_OTHER_OR_UNCERTAIN";
  return "QUALITY_OTHER_OR_UNCERTAIN";
}

function normalizeConfidence(input: unknown): ClassificationConfidence {
  const normalized = asString(input).toUpperCase() as ClassificationConfidence;
  if (classificationConfidenceValues.has(normalized)) return normalized;
  return normalized as ClassificationConfidence;
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
  const dueAt =
    asString(timeNode?.dueAt) ||
    asString(candidate.deadline) ||
    asString(candidate.dueAt);
  const dependencies = normalizeStringArray(candidate.dependencyTaskIds).length
    ? normalizeStringArray(candidate.dependencyTaskIds)
    : normalizeStringArray(candidate.dependencies);
  const owner = asString(candidate.owner);

  return {
    id: asString(candidate.id),
    title: asString(candidate.title),
    objective: asString(candidate.objective),
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
