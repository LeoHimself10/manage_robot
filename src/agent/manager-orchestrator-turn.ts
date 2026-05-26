import type { QwenPlannerConfig } from "./demo/qwen-planner";
import {
  buildScopeSwitchRetryUserMessage,
  buildTopicSwitchRetryUserMessage,
  buildDraftClarifyMixRetryUserMessage,
  detectDraftClarifyMix,
  detectFalseScopeSwitch,
  detectTopicSwitchWithoutArchive,
} from "./publish-staging";
import { runOrchestrator, type OrchestratorConfig, type OrchestratorResult } from "./orchestrator";
import {
  processAssignmentForTurn,
  type ProcessAssignmentTurnResult,
} from "./assignment/process-assignment-turn";
import {
  buildAssignRetryUserMessage,
  buildTaskIndexMap,
  detectFalseAssign,
} from "./assignment/false-assign";
import {
  buildSplitRetryUserMessage,
  detectFalseSplit,
} from "./draft-mutation/false-split";
import { hasAssigneeIntentInUserMessage } from "./orchestrator-turn-hints";
import { resolveDraftForOutbound } from "../view/draft-outbound";
import { createRecentPublishStore } from "./tools/publish-task";
import type { PlanSession } from "../infra/plan-session-store";
import {
  markPublishedAndRotatePlanSession,
  readDingtalkPlanIdRotateEnabled,
} from "../infra/plan-session-store";
import type { KnownFactsStore } from "./tools/update-known-facts";
import type { createEmployeeProfileRepo } from "../integrations/repos/employee-profile-repo";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "./role-routing";

const DEFAULT_ORCH_ITERATIONS = 6;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 8000;

/** Shared across DingTalk bot and workbench in the same process. */
export const sharedPublishRecentStore = createRecentPublishStore();

function readEnvBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

function readEnvInt(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.trunc(value));
}

export function isExplicitSearchRequest(input: string): boolean {
  const text = input.trim().toLowerCase();
  if (!text) return false;
  return /联网|搜索|查最新|外部资料|行业资料|外部案例|web search|search web|latest/i.test(
    text,
  );
}

export function buildManagerQwenClientConfig(
  base: QwenPlannerConfig,
): QwenPlannerConfig {
  return {
    ...base,
    thinking: readEnvBool("DINGTALK_QWEN_THINKING", false),
    timeoutMs: readEnvInt("DINGTALK_QWEN_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    maxTokens: Math.min(
      base.maxTokens,
      readEnvInt("DINGTALK_QWEN_MAX_TOKENS", DEFAULT_MAX_TOKENS),
    ),
    stream: readEnvBool("DINGTALK_QWEN_STREAM", true),
  };
}

export function readManagerOrchestratorMaxIterations(): number {
  return readEnvInt("DINGTALK_ORCHESTRATOR_MAX_ITERATIONS", DEFAULT_ORCH_ITERATIONS);
}

export function computeScopeRotatedSinceLastTurn(
  session: PlanSession,
): { fromLabel?: string; toLabel?: string } | undefined {
  const hist = session.conversationHistory;
  if (hist.length === 0) return undefined;
  const first = hist[0];
  if (typeof first.content !== "string" || !first.content.startsWith("[system_note]")) {
    return undefined;
  }
  if (hist.length > 3) return undefined;
  const trail = session.scopeAuditTrail ?? [];
  const last = trail[trail.length - 1];
  if (last && (last.eventType === "SCOPE_CREATED" || last.eventType === "SCOPE_RESTORED")) {
    const fromScopeId = last.fromScopeId;
    const fromLabel = fromScopeId
      ? session.taskScopes?.[fromScopeId]?.scopeLabel
      : undefined;
    return { fromLabel, toLabel: last.scopeLabel };
  }
  return {};
}

export interface ManagerOrchestratorTurnInput {
  userMessage: string;
  session: PlanSession;
  employeeRepo: ReturnType<typeof createEmployeeProfileRepo>;
  clientConfig: QwenPlannerConfig;
  memorySummary?: string;
  memoryFacts?: string[];
  actorName?: string;
  /** Workbench session role when not using DingTalk sender routing. */
  workbenchRole?: "manager" | "admin";
  senderStaffId: string;
}

export interface ManagerOrchestratorTurnResult {
  session: PlanSession;
  /** Plan id at turn start (before publish rotation). */
  preRotatePlanId: string;
  orchResult: OrchestratorResult;
  preTurnDraft: unknown;
  preTurnAssignment: unknown;
  persistedDraft?: Record<string, unknown>;
  draftForRender?: Record<string, unknown>;
  draftTouchedThisTurn: boolean;
  latestAssignment?: Record<string, unknown>;
  assignmentSection: string;
  assignState: ProcessAssignmentTurnResult;
  publishResult?: Record<string, unknown>;
  planRotatedAfterPublish: boolean;
  planRotateMeta?: { taskNo: string; fromPlanId: string; toPlanId: string };
  mutableKnownFacts: string[];
}

export async function runManagerOrchestratorTurn(
  input: ManagerOrchestratorTurnInput,
): Promise<ManagerOrchestratorTurnResult> {
  let session = { ...input.session };
  const preRotatePlanId = session.planId;
  const preTurnDraft = session.latestDraft;
  const preTurnAssignment = session.latestAssignment;
  let mutableKnownFacts = [...(session.knownFacts ?? [])];
  const knownFactsStore: KnownFactsStore = {
    get: () => mutableKnownFacts,
    update: (facts: string[]) => {
      mutableKnownFacts = Array.from(
        new Set([
          ...mutableKnownFacts,
          ...facts.map((f) => String(f).trim()).filter(Boolean),
        ]),
      ).slice(-50);
    },
  };

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
  const promptProfile = route.promptProfile;
  const resolvedRole =
    input.workbenchRole === "admin"
      ? "admin"
      : input.workbenchRole === "manager"
        ? "manager"
        : route.resolvedRole;

  let publishResult: Record<string, unknown> | undefined;
  const scopeRotatedSinceLastTurn = computeScopeRotatedSinceLastTurn(session);

  const buildOrchestratorConfig = (): OrchestratorConfig => ({
    clientConfig: input.clientConfig,
    employeeRepo: input.employeeRepo,
    maxToolIterations: readManagerOrchestratorMaxIterations(),
    toolProfile,
    promptProfile,
    managerFollowup: toolProfile === "manager" || toolProfile === "admin",
    trustedActorUserId: route.trustedActorUserId,
    allowSearchWeb: isExplicitSearchRequest(input.userMessage),
    knownFactsStore,
    currentSessionPlanId: session.planId,
    currentSession: session,
    publishRecentStore: sharedPublishRecentStore,
    actorName: input.actorName,
    actorRole:
      resolvedRole === "admin"
        ? "admin"
        : resolvedRole === "manager"
          ? "manager"
          : resolvedRole === "employee"
            ? "employee"
            : "manager",
    onPublishTaskResult: (result: Record<string, unknown>) => {
      publishResult = result;
    },
    onSessionMutated: (mutated) => {
      session = { ...session, ...mutated };
      mutableKnownFacts = [...(mutated.knownFacts ?? mutableKnownFacts)];
    },
    sessionContext: {
      conversationHistory: session.conversationHistory,
      planId: session.planId,
      latestDraft: session.latestDraft,
      latestAssignment: session.latestAssignment,
      memorySummary: input.memorySummary,
      memoryFacts: (input.memoryFacts ?? mutableKnownFacts).slice(0, 8),
      currentTimeIso: new Date().toISOString(),
      pendingRoster: session.pendingRosterText
        ? {
            sourceLabel: session.pendingRosterSource ?? "uploaded:roster",
            chars: session.pendingRosterText.length,
          }
        : undefined,
      candidatePool: session.candidatePool
        ? {
            source: session.candidatePool.source,
            entries: session.candidatePool.entries.map((e) => ({
              userId: e.userId,
              displayName: e.displayName,
              ...(e.fileNotes?.trim()
                ? { fileNotes: e.fileNotes.trim().slice(0, 200) }
                : {}),
            })),
            unresolvedCount: session.candidatePool.unresolved?.length,
          }
        : undefined,
      scopeRotatedSinceLastTurn,
    },
  });

  let orchResult = await runOrchestrator(input.userMessage, buildOrchestratorConfig());

  const initialOutbound = () => orchResult.messages.join("\n\n");

  if (
    detectFalseScopeSwitch({
      userMessage: input.userMessage,
      toolInvocationNames: orchResult.toolInvocationNames ?? [],
      outboundMarkdown: initialOutbound(),
    })
  ) {
    orchResult = await runOrchestrator(
      buildScopeSwitchRetryUserMessage(input.userMessage),
      buildOrchestratorConfig(),
    );
  }

  if (
    detectTopicSwitchWithoutArchive({
      userMessage: input.userMessage,
      preTurnLatestDraft: preTurnDraft,
      toolInvocationNames: orchResult.toolInvocationNames ?? [],
    })
  ) {
    orchResult = await runOrchestrator(
      buildTopicSwitchRetryUserMessage(input.userMessage),
      buildOrchestratorConfig(),
    );
  }

  if (
    detectDraftClarifyMix({
      message: initialOutbound(),
      hasDraft: orchResult.draft !== undefined,
    })
  ) {
    orchResult = await runOrchestrator(
      buildDraftClarifyMixRetryUserMessage(input.userMessage),
      buildOrchestratorConfig(),
    );
  }

  const applyDraftFromOrchestrator = (result: OrchestratorResult) => {
    const outbound = resolveDraftForOutbound({
      preTurnDraft,
      postTurnDraft: session.latestDraft,
      orchResultDraft: result.draft as Record<string, unknown> | undefined,
      toolInvocationNames: result.toolInvocationNames ?? [],
    });
    if (outbound.persistedDraft) {
      session.latestDraft = outbound.persistedDraft as PlanSession["latestDraft"];
    }
    return outbound;
  };

  let draftOutbound = applyDraftFromOrchestrator(orchResult);
  let { draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound;

  if (
    detectFalseSplit({
      userMessage: input.userMessage,
      preTurnDraft: preTurnDraft as Record<string, unknown> | undefined,
      postTurnDraft: persistedDraft as Record<string, unknown> | undefined,
      outboundMarkdown: orchResult.messages.join("\n\n"),
      toolInvocationNames: orchResult.toolInvocationNames ?? [],
      orchResultHasDraftJson: orchResult.draft !== undefined,
    })
  ) {
    orchResult = await runOrchestrator(
      buildSplitRetryUserMessage({
        originalUserMessage: input.userMessage,
        taskIndexMap: buildTaskIndexMap(persistedDraft as Record<string, unknown> | undefined),
      }),
      buildOrchestratorConfig(),
    );
    draftOutbound = applyDraftFromOrchestrator(orchResult);
    ({ draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound);
  }

  const employeesForAssignment = input.employeeRepo.list().map((e) => ({
    userId: e.userId,
    displayName: e.displayName,
  }));

  const runAssignmentProcessing = (
    result: OrchestratorResult,
    outbound: typeof draftOutbound,
  ) => {
    const assignmentDraft = outbound.draftForRender ?? outbound.persistedDraft;
    const taskIds = Array.isArray(
      (assignmentDraft as { tasks?: unknown[] } | undefined)?.tasks,
    )
      ? (
          assignmentDraft as { tasks: Array<{ id?: string }> }
        ).tasks
          .map((t) => (typeof t?.id === "string" ? t.id : ""))
          .filter((id) => id.length > 0)
      : [];
    return processAssignmentForTurn({
      preTurnDraft: preTurnDraft as Record<string, unknown> | undefined,
      persistedDraft: outbound.persistedDraft as Record<string, unknown> | undefined,
      sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
      orchAssignment: result.assignment,
      draftTouchedThisTurn: outbound.draftTouchedThisTurn,
      planId: session.planId,
      traceId: result.traceId,
      modelName: input.clientConfig.model,
      taskIds,
      employees: employeesForAssignment,
      candidatePoolUserIds: session.candidatePool?.entries.map((e) => e.userId),
      requireFullCoverage: true,
    });
  };

  let assignState = runAssignmentProcessing(orchResult, draftOutbound);

  const needsAssignRetry =
    process.env.ASSIGNMENT_PHASE_ENABLED === "1"
    && hasAssigneeIntentInUserMessage(input.userMessage)
    && assignState.coverage.total > 0
    && assignState.coverage.covered < assignState.coverage.total;

  if (needsAssignRetry) {
    orchResult = await runOrchestrator(
      buildAssignRetryUserMessage({
        originalUserMessage: input.userMessage,
        missingTaskIds: assignState.missingTaskIds,
        taskIndexMap: buildTaskIndexMap(persistedDraft as Record<string, unknown> | undefined),
      }),
      buildOrchestratorConfig(),
    );
    draftOutbound = applyDraftFromOrchestrator(orchResult);
    ({ draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound);
    assignState = runAssignmentProcessing(orchResult, draftOutbound);
  }

  let latestAssignment =
    assignState.latestAssignment
    ?? (preTurnAssignment as Record<string, unknown> | undefined);
  if (latestAssignment) {
    session.latestAssignment = latestAssignment as PlanSession["latestAssignment"];
  }

  let planRotatedAfterPublish = false;
  let planRotateMeta: ManagerOrchestratorTurnResult["planRotateMeta"];
  const pr = publishResult;
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
      scopeLabel: "（发布后新规划）",
      reason: "auto_rotate_after_publish",
    });
    if (!("skipped" in rotRes)) {
      planRotatedAfterPublish = true;
      planRotateMeta = {
        taskNo: String(taskRow?.taskNo ?? "").trim(),
        fromPlanId: rotRes.fromPlanId,
        toPlanId: rotRes.toPlanId,
      };
      mutableKnownFacts = [...(session.knownFacts ?? [])];
    }
  }

  return {
    session,
    preRotatePlanId,
    orchResult,
    preTurnDraft,
    preTurnAssignment,
    persistedDraft: persistedDraft as Record<string, unknown> | undefined,
    draftForRender: draftForRender as Record<string, unknown> | undefined,
    draftTouchedThisTurn,
    latestAssignment,
    assignmentSection: assignState.assignmentSection,
    assignState,
    publishResult,
    planRotatedAfterPublish,
    planRotateMeta,
    mutableKnownFacts,
  };
}
