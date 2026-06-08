import type { QwenPlannerConfig } from "./demo/qwen-planner";
import {
  buildScopeSwitchRetryUserMessage,
  detectFalseScopeSwitch,
} from "./publish-staging";
import { runOrchestrator, type OrchestratorConfig, type OrchestratorResult } from "./orchestrator";
import {
  processAssignmentForTurn,
  type ProcessAssignmentTurnResult,
} from "./assignment/process-assignment-turn";
import {
  resolveSessionAssignmentForTurn,
  resolveTurnLatestAssignment,
} from "./assignment/resolve-turn-assignment";
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
import { isWorkbenchProjectPortfolioEnabled } from "../security/workbench-project-portfolio";
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

/**
 * 用于「有草案 + 模型只口播不出 JSON」场景的重跑提示。
 * 不依赖用户消息正则；判断逻辑在调用处纯用状态字段完成。
 */
export function buildTableRedraftRetryMessage(originalUserMessage: string): string {
  return (
    `[draft_json_required] 用户要求：「${originalUserMessage}」\n` +
    "你刚才只在 message 里描述了子任务，但没有输出 draft JSON。请立刻重新输出完整草案：\n" +
    "- draft.tasks[] 须包含全量子任务（不得减少条数）\n" +
    "- message 简要说明变更点即可\n" +
    "禁止只口播不出 JSON。"
  );
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
  const preTurnPlanId = session.planId;
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
    projectPortfolioEnabled: route.trustedActorUserId
      ? isWorkbenchProjectPortfolioEnabled(route.trustedActorUserId)
      : false,
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

  /** 每个 user turn 最多允许的 orchestrator 重跑次数（默认 1）。 */
  const maxReruns = readEnvInt("MANAGER_TURN_MAX_RERUNS", 1);
  let rerunsUsed = 0;

  let orchResult = await runOrchestrator(input.userMessage, buildOrchestratorConfig());

  // 假口播归档（话术说已归档但未调 start_new_task）→ 数据完整性问题，保留重跑。
  if (
    rerunsUsed < maxReruns
    && detectFalseScopeSwitch({
      userMessage: input.userMessage,
      toolInvocationNames: orchResult.toolInvocationNames ?? [],
      outboundMarkdown: orchResult.messages.join("\n\n"),
    })
  ) {
    orchResult = await runOrchestrator(
      buildScopeSwitchRetryUserMessage(input.userMessage),
      buildOrchestratorConfig(),
    );
    rerunsUsed++;
  }

  // 话术类问题（topic-switch-without-archive、draft-clarify-mix）已由 prompt 单一事实源预防，
  // 不再重跑，避免串联多次完整 orchestrator 调用。

  const applyDraftFromOrchestrator = (result: OrchestratorResult) => {
    const outbound = resolveDraftForOutbound({
      preTurnDraft,
      postTurnDraft: session.latestDraft,
      orchResultDraft: result.draft as Record<string, unknown> | undefined,
      orchResultAssignment: result.assignment,
      toolInvocationNames: result.toolInvocationNames ?? [],
    });
    if (outbound.persistedDraft) {
      session.latestDraft = outbound.persistedDraft as PlanSession["latestDraft"];
    }
    return outbound;
  };

  let draftOutbound = applyDraftFromOrchestrator(orchResult);
  let { draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound;

  // 假拆分（话术声称已拆但 tasks.length 未增）→ 落库正确性问题，保留重跑。
  if (
    rerunsUsed < maxReruns
    && detectFalseSplit({
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
    rerunsUsed++;
    draftOutbound = applyDraftFromOrchestrator(orchResult);
    ({ draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound);
  }

  // 有草案 + 模型口播了草案式内容但没出 JSON + 本轮未发布、未切换 scope
  // → 纯状态判断，无需解析用户意图。
  const preTurnHasDraftTasks =
    Array.isArray((preTurnDraft as { tasks?: unknown[] } | undefined)?.tasks)
    && (preTurnDraft as { tasks: unknown[] }).tasks.length > 0;

  if (
    rerunsUsed < maxReruns
    && preTurnHasDraftTasks
    && !publishResult
    && orchResult.draft === undefined
    && !(orchResult.toolInvocationNames ?? []).includes("start_new_task")
    && (orchResult.observabilityFlags ?? []).includes("orchestrator_draft_message_without_json")
  ) {
    orchResult = await runOrchestrator(
      buildTableRedraftRetryMessage(input.userMessage),
      buildOrchestratorConfig(),
    );
    rerunsUsed++;
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
      sessionAssignment: resolveSessionAssignmentForTurn({
        sessionLatest: session.latestAssignment as Record<string, unknown> | undefined,
        preTurnAssignment,
        sessionPlanId: session.planId,
        preTurnPlanId,
        toolInvocationNames: result.toolInvocationNames,
      }),
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

  // 指派覆盖不足 → 落库正确性问题，保留重跑（受 maxReruns 上限约束）。
  const needsAssignRetry =
    process.env.ASSIGNMENT_PHASE_ENABLED === "1"
    && rerunsUsed < maxReruns
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
    rerunsUsed++;
    draftOutbound = applyDraftFromOrchestrator(orchResult);
    ({ draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound);
    assignState = runAssignmentProcessing(orchResult, draftOutbound);
  }

  const latestAssignment = resolveTurnLatestAssignment({
    assignStateLatest: assignState.latestAssignment as Record<string, unknown> | undefined,
    sessionLatest: session.latestAssignment as Record<string, unknown> | undefined,
    preTurnAssignment,
    sessionPlanId: session.planId,
    preTurnPlanId,
    toolInvocationNames: orchResult.toolInvocationNames,
  });
  session.latestAssignment = latestAssignment as PlanSession["latestAssignment"];

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
