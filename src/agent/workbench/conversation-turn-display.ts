import type { OrchestratorResult } from "../orchestrator";
import { processAssignmentForTurn } from "../assignment/process-assignment-turn";
import {
  resolveSessionAssignmentForTurn,
  resolveTurnLatestAssignment,
} from "../assignment/resolve-turn-assignment";
import { resolveDraftForOutbound } from "../../view/draft-outbound";
import { buildAssistantDisplayMarkdown } from "../../view/conversation-display-markdown";
import type { PlanSession } from "../../infra/plan-session-store";

export interface BuildWorkbenchTurnDisplayInput {
  orchResult: OrchestratorResult;
  session: PlanSession;
  preTurnDraft: unknown;
  preTurnAssignment: unknown;
  preTurnPlanId?: string;
  modelName: string;
  employees: Array<{ userId: string; displayName: string }>;
  postTurnDraft?: unknown;
}

export interface WorkbenchTurnDisplayResult {
  pureAssistantMessage: string;
  displayContent: string;
  persistedDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  draftForRender?: Record<string, unknown>;
  draftTouchedThisTurn: boolean;
  assignmentSection: string;
}

export function buildWorkbenchTurnDisplay(
  input: BuildWorkbenchTurnDisplayInput,
): WorkbenchTurnDisplayResult {
  const postTurnDraft = input.postTurnDraft ?? input.session.latestDraft;
  const draftOutbound = resolveDraftForOutbound({
    preTurnDraft: input.preTurnDraft,
    postTurnDraft,
    orchResultDraft: input.orchResult.draft as Record<string, unknown> | undefined,
    orchResultAssignment: input.orchResult.assignment,
    toolInvocationNames: input.orchResult.toolInvocationNames ?? [],
  });

  const assignmentDraft = draftOutbound.draftForRender ?? draftOutbound.persistedDraft;
  const taskIds = Array.isArray((assignmentDraft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((assignmentDraft as { tasks: Array<{ id?: string }> }).tasks)
        .map((t) => (typeof t?.id === "string" ? t.id : ""))
        .filter((id) => id.length > 0)
    : [];

  const preTurnPlanId = input.preTurnPlanId ?? input.session.planId;
  const toolInvocationNames = input.orchResult.toolInvocationNames ?? [];

  const sessionAssignment = resolveSessionAssignmentForTurn({
    sessionLatest: input.session.latestAssignment as Record<string, unknown> | undefined,
    preTurnAssignment: input.preTurnAssignment,
    sessionPlanId: input.session.planId,
    preTurnPlanId,
    toolInvocationNames,
  });

  const assignState = processAssignmentForTurn({
    preTurnDraft: input.preTurnDraft as Record<string, unknown> | undefined,
    persistedDraft: draftOutbound.persistedDraft as Record<string, unknown> | undefined,
    sessionAssignment,
    orchAssignment: input.orchResult.assignment,
    draftTouchedThisTurn: draftOutbound.draftTouchedThisTurn,
    planId: input.session.planId,
    traceId: input.orchResult.traceId,
    modelName: input.modelName,
    taskIds,
    employees: input.employees,
    candidatePoolUserIds: input.session.candidatePool?.entries.map((e) => e.userId),
    requireFullCoverage: true,
  });

  const modelMessage = input.orchResult.messages.join("\n\n").trim() || "已处理。";
  const pureAssistantMessage = modelMessage;
  const latestAssignment = resolveTurnLatestAssignment({
    assignStateLatest: assignState.latestAssignment as Record<string, unknown> | undefined,
    sessionLatest: input.session.latestAssignment as Record<string, unknown> | undefined,
    preTurnAssignment: input.preTurnAssignment,
    sessionPlanId: input.session.planId,
    preTurnPlanId,
    toolInvocationNames,
  });
  const shouldRenderRichSection = Boolean(draftOutbound.draftForRender ?? draftOutbound.persistedDraft);

  const displayContent = buildAssistantDisplayMarkdown({
    modelMessage,
    currentDraft: draftOutbound.draftForRender ?? draftOutbound.persistedDraft,
    latestAssignment,
    shouldRenderRichSection,
    assignmentSection: assignState.assignmentSection,
  });

  return {
    pureAssistantMessage,
    displayContent,
    persistedDraft: draftOutbound.persistedDraft as Record<string, unknown> | undefined,
    latestAssignment,
    draftForRender: draftOutbound.draftForRender as Record<string, unknown> | undefined,
    draftTouchedThisTurn: draftOutbound.draftTouchedThisTurn,
    assignmentSection: assignState.assignmentSection,
  };
}
