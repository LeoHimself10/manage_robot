import {
  extractLightAssignment,
  renderLightAssignmentSection,
  type LightAssignmentDraft,
} from "./light-assignment";
import { mergeAssignmentRows, getAssignmentCoverage } from "./merge-assignment";
import { reconcileAssignmentWithDraft, type ReconcileAssignmentWarning } from "./reconcile-assignment";

export interface ProcessAssignmentTurnInput {
  preTurnDraft?: Record<string, unknown>;
  persistedDraft?: Record<string, unknown>;
  sessionAssignment?: Record<string, unknown>;
  orchAssignment?: unknown;
  draftTouchedThisTurn: boolean;
  planId: string;
  traceId: string;
  modelName: string;
  taskIds: string[];
  employees: Array<{ userId: string; displayName: string }>;
  candidatePoolUserIds?: string[];
  requireFullCoverage?: boolean;
}

export interface ProcessAssignmentTurnResult {
  latestAssignment?: Record<string, unknown>;
  assignmentSection: string;
  lightDraft?: LightAssignmentDraft;
  extractOk: boolean;
  extractReason?: string;
  missingTaskIds: string[];
  coverage: ReturnType<typeof getAssignmentCoverage>;
  reconcileWarnings: ReconcileAssignmentWarning[];
}

export function processAssignmentForTurn(
  input: ProcessAssignmentTurnInput,
): ProcessAssignmentTurnResult {
  let workingAssignment = input.sessionAssignment;
  let reconcileWarnings: ReconcileAssignmentWarning[] = [];

  if (input.persistedDraft && input.draftTouchedThisTurn) {
    const reconciled = reconcileAssignmentWithDraft({
      previousDraft: input.preTurnDraft,
      currentDraft: input.persistedDraft,
      assignment: workingAssignment,
    });
    workingAssignment = reconciled.assignment;
    reconcileWarnings = reconciled.warnings;
  }

  let assignmentSection = "";
  let lightDraft: LightAssignmentDraft | undefined;
  let extractOk = false;
  let extractReason: string | undefined;
  let missingTaskIds: string[] = [];

  if (input.orchAssignment !== undefined && input.taskIds.length > 0) {
    const assignmentResult = extractLightAssignment({
      rawAssignment: input.orchAssignment,
      planId: input.planId,
      traceId: input.traceId,
      modelName: input.modelName,
      taskIds: input.taskIds,
      employees: input.employees,
      candidatePoolUserIds: input.candidatePoolUserIds,
      requireFullCoverage: input.requireFullCoverage !== false,
    });
    if (assignmentResult.ok) {
      extractOk = true;
      lightDraft = assignmentResult.draft;
      workingAssignment = mergeAssignmentRows(
        workingAssignment,
        assignmentResult.draft as unknown as Record<string, unknown>,
      );
      assignmentSection = renderLightAssignmentSection(assignmentResult.draft);
    } else {
      extractReason = assignmentResult.reason;
      missingTaskIds = assignmentResult.missingTaskIds ?? [];
    }
  }

  const coverage = getAssignmentCoverage(input.persistedDraft, workingAssignment);
  if (coverage.missingTaskIds.length > 0 && missingTaskIds.length === 0) {
    missingTaskIds = coverage.missingTaskIds;
  }

  return {
    latestAssignment: workingAssignment,
    assignmentSection,
    lightDraft,
    extractOk,
    extractReason,
    missingTaskIds,
    coverage,
    reconcileWarnings,
  };
}
