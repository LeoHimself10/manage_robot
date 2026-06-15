import type { QwenPlannerConfig } from "../demo/qwen-planner";
import {
  processAssignmentForTurn,
  type ProcessAssignmentTurnResult,
} from "../assignment/process-assignment-turn";
import {
  resolveSessionAssignmentForTurn,
  resolveTurnLatestAssignment,
} from "../assignment/resolve-turn-assignment";
import { isWorkbenchProjectPortfolioEnabled } from "../../security/workbench-project-portfolio";
import {
  markPublishedAndRotatePlanSession,
  readDingtalkPlanIdRotateEnabled,
} from "../../infra/plan-session-store";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../role-routing";
import type { PlanSession } from "../../infra/plan-session-store";
import type { createEmployeeProfileRepo } from "../../integrations/repos/employee-profile-repo";
import {
  buildManagerQwenClientConfig,
  readManagerOrchestratorMaxIterations,
  readManagerTurnMaxReruns,
  sharedPublishRecentStore,
  type ManagerOrchestratorTurnInput,
  type ManagerOrchestratorTurnResult,
} from "../manager-orchestrator-turn";
import { DRAFT_MUTATING_TOOL_NAMES } from "../../view/draft-outbound";
import { logStructured } from "../../infra/logger";
import { buildV2ChatModel, readV2ThinkingEnabled } from "./model";
import { runV2AgentTurn, type V2GraphRunInput, type V2GraphRunResult } from "./graph";
import { decideTurnToolChoice } from "./tool-choice-gate";
import { getAssignmentCoverage } from "../assignment/merge-assignment";
import type { OrchestratorResult } from "../orchestrator";
import {
  mergeV2GraphResults,
  pickV2Retry,
} from "./turn-requirements";
import {
  snapshotTurnState,
  restoreFromSnapshot,
  verifyRetryCommit,
  RETRY_KIND_GATES,
} from "./turn-contract";

function isDraftTouchedByTools(
  preTurnDraft: unknown,
  postTurnDraft: unknown,
  toolNames: string[],
): boolean {
  if (toolNames.some((n) => DRAFT_MUTATING_TOOL_NAMES.has(n) || n === "replace_draft")) {
    return true;
  }
  return postTurnDraft != null && postTurnDraft !== preTurnDraft;
}

function buildAssignState(input: {
  preTurnDraft: unknown;
  persistedDraft: Record<string, unknown> | undefined;
  session: PlanSession;
  preTurnAssignment: unknown;
  preTurnPlanId: string;
  toolInvocationNames: string[];
  draftTouchedThisTurn: boolean;
  traceId: string;
  modelName: string;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
}): ProcessAssignmentTurnResult {
  const taskIds = Array.isArray((input.persistedDraft as { tasks?: Array<{ id?: string }> } | undefined)?.tasks)
    ? ((input.persistedDraft as { tasks: Array<{ id?: string }> }).tasks)
        .map((t) => String(t.id ?? "").trim())
        .filter(Boolean)
    : [];

  const employeesForAssignment = input.employeeRepo.list().map((e) => ({
    userId: e.userId,
    displayName: e.displayName,
  }));

  return processAssignmentForTurn({
    preTurnDraft: input.preTurnDraft as Record<string, unknown> | undefined,
    persistedDraft: input.persistedDraft,
    sessionAssignment: resolveSessionAssignmentForTurn({
      sessionLatest: input.session.latestAssignment as Record<string, unknown> | undefined,
      preTurnAssignment: input.preTurnAssignment,
      sessionPlanId: input.session.planId,
      preTurnPlanId: input.preTurnPlanId,
      toolInvocationNames: input.toolInvocationNames,
    }),
    orchAssignment: undefined,
    draftTouchedThisTurn: input.draftTouchedThisTurn,
    planId: input.session.planId,
    traceId: input.traceId,
    modelName: input.modelName,
    taskIds,
    employees: employeesForAssignment,
    candidatePoolUserIds: input.session.candidatePool?.entries.map((e) => e.userId),
    requireFullCoverage: true,
  });
}

export async function runManagerOrchestratorTurnV2(
  input: ManagerOrchestratorTurnInput,
): Promise<ManagerOrchestratorTurnResult> {
  let session = { ...input.session };
  const preRotatePlanId = session.planId;
  const preTurnPlanId = session.planId;
  const preTurnDraft = session.latestDraft;
  const preTurnAssignment = session.latestAssignment;

  const roleRoutingEnabled = isDingtalkRoleRoutingEnabled();
  const route = resolveDingtalkAgentRouting({
    senderStaffId: input.senderStaffId,
    employeeRepo: input.employeeRepo,
    roleRoutingEnabled,
  });

  const toolProfile =
    input.workbenchRole === "admin"
      ? "admin"
      : input.workbenchRole === "manager"
        ? "manager"
        : route.toolProfile;
  const resolvedRole =
    input.workbenchRole === "admin"
      ? "admin"
      : input.workbenchRole === "manager"
        ? "manager"
        : route.resolvedRole;

  let publishResult: Record<string, unknown> | undefined;
  const clientConfig = buildManagerQwenClientConfig(input.clientConfig);
  const model = buildV2ChatModel(clientConfig);

  const invokeV2Graph = (
    userMessage: string,
    opts?: { explicitGate?: V2GraphRunInput["explicitGate"] },
  ): Promise<V2GraphRunResult> => {
    const graphInput: V2GraphRunInput = {
      userMessage,
      explicitGate: opts?.explicitGate,
      session,
      model,
      clientConfig,
      employeeRepo: input.employeeRepo,
      toolProfile,
      promptOpts: {
        managerFollowup: toolProfile === "manager" || toolProfile === "admin",
        projectPortfolioEnabled: route.trustedActorUserId
          ? isWorkbenchProjectPortfolioEnabled(route.trustedActorUserId)
          : false,
      },
      trustedActorUserId: route.trustedActorUserId,
      actorName: input.actorName,
      actorRole:
        resolvedRole === "admin"
          ? "admin"
          : resolvedRole === "manager"
            ? "manager"
            : resolvedRole === "employee"
              ? "employee"
              : "manager",
      allowSearchWeb: true,
      publishRecentStore: sharedPublishRecentStore,
      conversationHistory: session.conversationHistory,
      maxToolIterations: readManagerOrchestratorMaxIterations(),
      onSessionMutated: (mutated) => {
        session = { ...session, ...mutated };
      },
      onPublishTaskResult: (result) => {
        publishResult = result;
      },
    };
    return runV2AgentTurn(graphInput);
  };

  let graphResult = await invokeV2Graph(input.userMessage);

  const maxReruns = readManagerTurnMaxReruns();
  let rerunsUsed = 0;

  // C3 degrade: turns covered by the in-graph tool_choice gate (patch / publish /
  // rosterAssign) are constrained at decode time, so skip the out-of-graph rerun
  // loop for them (same inputs as graph.ts → "同输入"). Uncovered turns keep the
  // existing 1-rerun/turn behavior.
  const turnGate = await decideTurnToolChoice({
    userMessage: input.userMessage,
    session,
    toolProfile,
    trustedActorUserId: route.trustedActorUserId,
    assignCoverage: getAssignmentCoverage(
      preTurnDraft as Record<string, unknown> | undefined,
      preTurnAssignment as Record<string, unknown> | undefined,
    ),
    thinkingEnabled: readV2ThinkingEnabled(),
    classifierConfig: {
      apiKey: clientConfig.apiKey,
      baseUrl: clientConfig.baseUrl,
    },
  });

  while (rerunsUsed < maxReruns && turnGate.toolChoice === "auto") {
    const persistedDraft = session.latestDraft as Record<string, unknown> | undefined;
    const draftTouchedThisTurn = isDraftTouchedByTools(
      preTurnDraft,
      persistedDraft,
      graphResult.toolInvocationNames,
    );
    const assignState = buildAssignState({
      preTurnDraft,
      persistedDraft,
      session,
      preTurnAssignment,
      preTurnPlanId,
      toolInvocationNames: graphResult.toolInvocationNames,
      draftTouchedThisTurn,
      traceId: graphResult.traceId,
      modelName: clientConfig.model,
      employeeRepo: input.employeeRepo,
    });

    // Rule 1: pass gateReason so incompatible retry kinds are skipped.
    const retryDecision = pickV2Retry({
      userMessage: input.userMessage,
      session,
      preTurnDraft: preTurnDraft as Record<string, unknown> | undefined,
      persistedDraft,
      toolInvocationNames: graphResult.toolInvocationNames,
      outboundMarkdown: graphResult.finalMessage,
      publishResult: publishResult ?? graphResult.publishResult,
      assignCoverage: assignState.coverage,
      missingTaskIds: assignState.missingTaskIds,
      retryOpts: input.v2RetryOpts,
      gateReason: turnGate.reason,
    });

    if (!retryDecision) break;

    // Rule 3: snapshot before retry so we can roll back on violation.
    const preRetrySnapshot = snapshotTurnState(session);

    // Rule 2: retry runs with its own narrow explicit gate — never unconstrained.
    const retryGate = RETRY_KIND_GATES[retryDecision.kind];
    const retryResult = await invokeV2Graph(retryDecision.message, { explicitGate: retryGate });

    // Rule 3: verify the retry result preserves state invariants.
    const verification = verifyRetryCommit(preRetrySnapshot, session, retryDecision.kind);
    if (!verification.commit) {
      // Rollback: discard retry side-effects, restore prior state, skip merge.
      session = restoreFromSnapshot(session, preRetrySnapshot);
      logStructured({
        event: "v2_retry_rolled_back",
        kind: retryDecision.kind,
        violations: verification.violations,
        retryTraceId: retryResult.traceId,
      });
      rerunsUsed += 1;
      break;
    }

    graphResult = mergeV2GraphResults(graphResult, retryResult);
    rerunsUsed += 1;
  }

  const persistedDraft = session.latestDraft as Record<string, unknown> | undefined;
  const draftTouchedThisTurn = isDraftTouchedByTools(
    preTurnDraft,
    persistedDraft,
    graphResult.toolInvocationNames,
  );

  let assignState = buildAssignState({
    preTurnDraft,
    persistedDraft,
    session,
    preTurnAssignment,
    preTurnPlanId,
    toolInvocationNames: graphResult.toolInvocationNames,
    draftTouchedThisTurn,
    traceId: graphResult.traceId,
    modelName: clientConfig.model,
    employeeRepo: input.employeeRepo,
  });

  const latestAssignment = resolveTurnLatestAssignment({
    assignStateLatest: assignState.latestAssignment as Record<string, unknown> | undefined,
    sessionLatest: session.latestAssignment as Record<string, unknown> | undefined,
    preTurnAssignment,
    sessionPlanId: session.planId,
    preTurnPlanId,
    toolInvocationNames: graphResult.toolInvocationNames,
  });
  session.latestAssignment = latestAssignment as PlanSession["latestAssignment"];

  let planRotatedAfterPublish = false;
  let planRotateMeta: ManagerOrchestratorTurnResult["planRotateMeta"];
  const pr = publishResult ?? graphResult.publishResult;
  if (
    readDingtalkPlanIdRotateEnabled()
    && pr
    && String(pr.ok ?? "") === "true"
    && String(pr.alreadyPublished ?? "") !== "true"
    && pr.dedupedByLru !== true
    && String(pr.reason ?? "") !== "unknown_assignees"
  ) {
    const taskRow = pr.task as { taskNo?: string } | undefined;
    const rotRes = markPublishedAndRotatePlanSession(session, {
      taskNo: String(taskRow?.taskNo ?? "").trim(),
      scopeLabel: "（发放后新规划）",
      reason: "auto_rotate_after_publish",
    });
    if (!("skipped" in rotRes)) {
      planRotatedAfterPublish = true;
      planRotateMeta = {
        taskNo: String(taskRow?.taskNo ?? "").trim(),
        fromPlanId: rotRes.fromPlanId,
        toPlanId: rotRes.toPlanId,
      };
    }
  }

  const orchResult: OrchestratorResult = {
    messages: [graphResult.finalMessage],
    draft: undefined,
    assignment: undefined,
    publishResult: pr,
    traceId: graphResult.traceId,
    toolCallsTotal: graphResult.toolCallsTotal,
    toolInvocationNames: graphResult.toolInvocationNames,
    observabilityFlags: graphResult.observabilityFlags,
    timing: {
      totalMs: graphResult.timing.totalMs,
      llmMsTotal: graphResult.timing.llmMsTotal,
      toolsMsTotal: graphResult.timing.toolsMsTotal,
      iterations: graphResult.timing.iterations.map((it) => ({
        iteration: it.iteration,
        llmMs: it.llmMs,
        toolsMs: it.toolsMs,
        toolCalls: it.toolCalls,
        totalMs: it.llmMs + it.toolsMs,
        tools: it.tools,
      })),
    },
  };

  return {
    session,
    preRotatePlanId,
    orchResult,
    preTurnDraft,
    preTurnAssignment,
    persistedDraft,
    draftForRender: persistedDraft,
    draftTouchedThisTurn,
    latestAssignment,
    assignmentSection: assignState.assignmentSection,
    assignState,
    publishResult: pr,
    planRotatedAfterPublish,
    planRotateMeta,
    mutableKnownFacts: [...(session.knownFacts ?? [])],
  };
}

export function readOrchestratorEngine(): "legacy" | "v2" {
  const v = String(process.env.ORCHESTRATOR_ENGINE ?? "legacy").trim().toLowerCase();
  return v === "v2" ? "v2" : "legacy";
}
