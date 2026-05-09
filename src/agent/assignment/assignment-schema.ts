import type { AssignmentCandidate, AssignmentDraft, AssignmentRiskFlag, Confidence, SubTaskAssignment } from "./types";

const VALID_CONFIDENCE_VALUES = new Set<string>(["HIGH", "MEDIUM", "LOW"]);
const VALID_RISK_TYPES = new Set<string>([
  "OVERLOAD",
  "MISSING_PERMISSION",
  "CROSS_DEPARTMENT",
  "RECENT_REJECTION",
  "INSUFFICIENT_EVIDENCE",
  "OTHER",
]);

export interface AssignmentValidationOptions {
  allowedUserIds?: string[];
  taskIds?: string[];
}

function normalizeString(val: unknown): string | undefined {
  if (typeof val === "string") {
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function asStringOrUndefined(val: unknown): string | undefined {
  if (typeof val === "string") return val;
  return undefined;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function coerceRiskFlag(raw: unknown): AssignmentRiskFlag | undefined {
  if (!isPlainObject(raw)) return undefined;
  const type = normalizeString(raw.type);
  const description = normalizeString(raw.description);
  if (!type || !description) return undefined;
  if (!VALID_RISK_TYPES.has(type)) return undefined;
  return { type: type as AssignmentRiskFlag["type"], description };
}

function coerceCandidate(raw: unknown): AssignmentCandidate | undefined {
  if (!isPlainObject(raw)) return undefined;
  const userId = normalizeString(raw.userId);
  const displayName = normalizeString(raw.displayName);
  const rationale = normalizeString(raw.rationale);
  if (!userId || !displayName || !rationale) return undefined;

  const candidate: AssignmentCandidate = {
    userId,
    displayName,
    rationale,
  };

  if (Array.isArray(raw.evidenceRefs)) {
    const refs = raw.evidenceRefs.map((r: unknown) => normalizeString(r)).filter(Boolean) as string[];
    if (refs.length > 0) candidate.evidenceRefs = refs;
  }

  if (Array.isArray(raw.risks)) {
    const risks = raw.risks.map(coerceRiskFlag).filter(Boolean) as AssignmentRiskFlag[];
    if (risks.length > 0) candidate.risks = risks;
  }

  return candidate;
}

export function coerceAssignmentDraft(raw: unknown): AssignmentDraft {
  if (!isPlainObject(raw)) {
    throw new Error("coerceAssignmentDraft: input must be a non-null object");
  }

  const planId = normalizeString(raw.planId) ?? "";
  const traceId = normalizeString(raw.traceId) ?? "";
  const generatedAt = normalizeString(raw.generatedAt) ?? new Date().toISOString();
  const promptVersion = normalizeString(raw.promptVersion) ?? "";
  const modelName = normalizeString(raw.modelName) ?? "";

  const assignments: SubTaskAssignment[] = [];
  if (Array.isArray(raw.assignments)) {
    for (const item of raw.assignments) {
      const coerced = coerceSubTaskAssignment(item);
      if (coerced) assignments.push(coerced);
    }
  }

  let globalRisks: AssignmentRiskFlag[] | undefined;
  if (Array.isArray(raw.globalRisks)) {
    const risks = raw.globalRisks.map(coerceRiskFlag).filter(Boolean) as AssignmentRiskFlag[];
    if (risks.length > 0) globalRisks = risks;
  }

  return {
    planId,
    traceId,
    generatedAt,
    promptVersion,
    modelName,
    assignments,
    globalRisks,
  };
}

function coerceSubTaskAssignment(raw: unknown): SubTaskAssignment | undefined {
  if (!isPlainObject(raw)) return undefined;

  const taskId = normalizeString(raw.taskId);
  if (!taskId) return undefined;

  const primary = coerceCandidate(raw.primary);
  if (!primary) return undefined;

  const alternates: AssignmentCandidate[] = [];
  if (Array.isArray(raw.alternates)) {
    for (const alt of raw.alternates) {
      const coercedAlt = coerceCandidate(alt);
      if (coercedAlt) alternates.push(coercedAlt);
    }
  }

  const rawConfidence = normalizeString(raw.confidence);
  if (!rawConfidence || !VALID_CONFIDENCE_VALUES.has(rawConfidence)) return undefined;

  const confidenceReason = normalizeString(raw.confidenceReason);
  if (!confidenceReason) return undefined;

  const result: SubTaskAssignment = {
    taskId,
    primary,
    alternates,
    confidence: rawConfidence as Confidence,
    confidenceReason,
  };

  if (Array.isArray(raw.managerQuestions)) {
    const qs = raw.managerQuestions.map((q: unknown) => normalizeString(q)).filter(Boolean) as string[];
    if (qs.length > 0) result.managerQuestions = qs;
  }
  if (raw.modelSelfCritique) {
    const sc = asStringOrUndefined(raw.modelSelfCritique);
    if (sc) result.modelSelfCritique = sc;
  }

  return result;
}

export function validateAssignmentDraft(
  draft: AssignmentDraft,
  options?: AssignmentValidationOptions,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required top-level string fields
  if (!draft.planId) errors.push("planId must be non-empty");
  if (!draft.traceId) errors.push("traceId must be non-empty");
  if (!draft.generatedAt) errors.push("generatedAt must be non-empty");
  if (!draft.promptVersion) errors.push("promptVersion must be non-empty");
  if (!draft.modelName) errors.push("modelName must be non-empty");

  // Assignments must exist
  if (!Array.isArray(draft.assignments) || draft.assignments.length === 0) {
    errors.push("assignments must be a non-empty array");
    return { valid: false, errors };
  }

  // Validate each assignment
  const taskIdSet = options?.taskIds ? new Set(options.taskIds) : null;
  const userIdSet = options?.allowedUserIds ? new Set(options.allowedUserIds) : null;

  for (let i = 0; i < draft.assignments.length; i++) {
    const a = draft.assignments[i];
    const prefix = `assignments[${i}]`;

    // taskId check
    if (!a.taskId) {
      errors.push(`${prefix}.taskId must be non-empty`);
    } else if (taskIdSet && !taskIdSet.has(a.taskId)) {
      errors.push(`${prefix}.taskId "${a.taskId}" not in allowed taskIds`);
    }

    // confidence check
    if (!VALID_CONFIDENCE_VALUES.has(a.confidence)) {
      errors.push(`${prefix}.confidence must be one of HIGH, MEDIUM, LOW, got "${a.confidence}"`);
    }

    // confidenceReason
    if (!a.confidenceReason) errors.push(`${prefix}.confidenceReason must be non-empty`);

    // primary
    validateCandidate(a.primary, `${prefix}.primary`, userIdSet, errors);

    // alternates must be an array
    if (!Array.isArray(a.alternates)) {
      errors.push(`${prefix}.alternates must be an array`);
    } else {
      // alternates should not be empty (but spec says "at least 1")
      if (a.alternates.length === 0) {
        errors.push(`${prefix}.alternates must contain at least 1 candidate`);
      }
      const altUserIds = new Set<string>();
      for (let j = 0; j < a.alternates.length; j++) {
        validateCandidate(a.alternates[j], `${prefix}.alternates[${j}]`, userIdSet, errors);
        if (a.alternates[j].userId) {
          if (altUserIds.has(a.alternates[j].userId)) {
            errors.push(`${prefix}.alternates[${j}].userId "${a.alternates[j].userId}" is duplicated`);
          }
          altUserIds.add(a.alternates[j].userId);
          // alternates must not contain the same userId as primary
          if (a.alternates[j].userId === a.primary.userId) {
            errors.push(`${prefix}.alternates[${j}].userId "${a.alternates[j].userId}" must not match primary.userId`);
          }
        }
      }
    }

    // managerQuestions
    if (a.managerQuestions) {
      for (let j = 0; j < a.managerQuestions.length; j++) {
        if (!a.managerQuestions[j] || !a.managerQuestions[j].trim()) {
          errors.push(`${prefix}.managerQuestions[${j}] must be non-empty`);
        }
      }
    }

    // risks on primary
    if (a.primary.risks) {
      validateRiskFlags(a.primary.risks, `${prefix}.primary.risks`, errors);
    }

    // risks on alternates
    if (a.alternates) {
      for (let j = 0; j < a.alternates.length; j++) {
        if (a.alternates[j].risks) {
          validateRiskFlags(a.alternates[j].risks!, `${prefix}.alternates[${j}].risks`, errors);
        }
      }
    }
  }

  // globalRisks
  if (draft.globalRisks) {
    validateRiskFlags(draft.globalRisks, "globalRisks", errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateCandidate(
  c: AssignmentCandidate,
  prefix: string,
  allowedUserIds: Set<string> | null,
  errors: string[],
): void {
  if (!c.userId) {
    errors.push(`${prefix}.userId must be non-empty`);
  } else if (allowedUserIds && !allowedUserIds.has(c.userId)) {
    errors.push(`${prefix}.userId "${c.userId}" not in allowedUserIds`);
  }
  if (!c.displayName) errors.push(`${prefix}.displayName must be non-empty`);
  if (!c.rationale) errors.push(`${prefix}.rationale must be non-empty`);
}

function validateRiskFlags(
  flags: AssignmentRiskFlag[],
  prefix: string,
  errors: string[],
): void {
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (!VALID_RISK_TYPES.has(f.type)) {
      errors.push(`${prefix}[${i}].type must be one of OVERLOAD, MISSING_PERMISSION, CROSS_DEPARTMENT, RECENT_REJECTION, INSUFFICIENT_EVIDENCE, OTHER, got "${f.type}"`);
    }
    if (!f.description) {
      errors.push(`${prefix}[${i}].description must be non-empty`);
    }
  }
}
