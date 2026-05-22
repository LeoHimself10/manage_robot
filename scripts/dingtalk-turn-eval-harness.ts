/**
 * Eval harness: one user turn through the same post-orchestrator path as dingtalk-bot
 * (retries → resolveDraftForOutbound → processAssignmentForTurn → assign retry).
 */
import type { PlanSession } from "../src/infra/plan-session-store";
import { runOrchestrator } from "../src/agent/orchestrator";
import type { QwenPlannerConfig } from "../src/agent/demo/qwen-planner";
import { createEmployeeProfileRepo } from "../src/integrations/repos/employee-profile-repo";
import { resolveEmployeeProfileDir } from "../src/infra/assignment-env";
import { createRecentPublishStore } from "../src/agent/tools/publish-task";
import { processAssignmentForTurn, type ProcessAssignmentTurnResult } from "../src/agent/assignment/process-assignment-turn";
import {
  buildAssignRetryUserMessage,
  buildTaskIndexMap,
} from "../src/agent/assignment/false-assign";
import { hasAssigneeIntentInUserMessage } from "../src/agent/orchestrator-turn-hints";
import { resolveDraftForOutbound } from "../src/view/draft-outbound";
import {
  buildDraftClarifyMixRetryUserMessage,
  buildPublishRetryUserMessage,
  buildScopeSwitchRetryUserMessage,
  buildTopicSwitchRetryUserMessage,
  detectDraftClarifyMix,
  detectFalseScopeSwitch,
  detectTopicSwitchWithoutArchive,
} from "../src/agent/publish-staging";
import { publishResultSucceeded } from "../src/agent/publish-helpers";
import {
  isDingtalkRoleRoutingEnabled,
  resolveDingtalkAgentRouting,
} from "../src/agent/role-routing";

export interface DingtalkTurnEvalOptions {
  clientConfig: QwenPlannerConfig;
  senderStaffId: string;
  actorName?: string;
  maxToolIterations?: number;
  allowAssignRetry?: boolean;
  /** Eval-only: retry once when publish confirm did not invoke publish_task. */
  allowPublishRetry?: boolean;
  managerFollowup?: boolean;
  /** scope/topic/clarify 重试（预置草案点将 eval 可关闭以免误触 start_new_task） */
  enableDingtalkPreRetries?: boolean;
}

export interface DingtalkTurnEvalResult {
  traceId: string;
  tools: string[];
  messages: string[];
  outboundMessage: string;
  ms: number;
  hasDraftJson: boolean;
  draftForRender?: Record<string, unknown>;
  persistedDraft?: Record<string, unknown>;
  assignState: ProcessAssignmentTurnResult;
  publishResult?: Record<string, unknown>;
  publishOk: boolean;
  stopReason?: string;
}

function collectTools(existing: string[], next: string[] | undefined): string[] {
  return [...existing, ...(next ?? [])];
}

export async function runDingtalkLikeTurn(
  session: PlanSession,
  userMessage: string,
  opts: DingtalkTurnEvalOptions,
): Promise<DingtalkTurnEvalResult> {
  const employeeRepo = createEmployeeProfileRepo(resolveEmployeeProfileDir());
  const route = resolveDingtalkAgentRouting({
    senderStaffId: opts.senderStaffId,
    employeeRepo,
    roleRoutingEnabled: isDingtalkRoleRoutingEnabled(),
  });
  const publishRecentStore = createRecentPublishStore();
  const preTurnDraft = session.latestDraft as Record<string, unknown> | undefined;
  const preTurnAssignment = session.latestAssignment;
  let publishResult: Record<string, unknown> | undefined;
  let allTools: string[] = [];
  const t0 = Date.now();

  const buildConfig = () => ({
    clientConfig: opts.clientConfig,
    employeeRepo,
    maxToolIterations: opts.maxToolIterations ?? Number(process.env.DINGTALK_ORCHESTRATOR_MAX_ITERATIONS ?? 10),
    toolProfile: route.toolProfile,
    promptProfile: route.promptProfile,
    managerFollowup:
      opts.managerFollowup
      ?? (route.toolProfile === "manager" || route.toolProfile === "admin"),
    trustedActorUserId: route.trustedActorUserId,
    actorName: opts.actorName,
    actorRole:
      route.resolvedRole === "admin"
        ? ("admin" as const)
        : route.resolvedRole === "manager"
          ? ("manager" as const)
          : ("employee" as const),
    currentSessionPlanId: session.planId,
    currentSession: session,
    publishRecentStore,
    onPublishTaskResult: (result: Record<string, unknown>) => {
      publishResult = result;
    },
    sessionContext: {
      conversationHistory: session.conversationHistory,
      planId: session.planId,
      latestDraft: session.latestDraft as Record<string, unknown> | undefined,
      latestAssignment: session.latestAssignment,
      memoryFacts: session.knownFacts,
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
            })),
            unresolvedCount: session.candidatePool.unresolved?.length,
          }
        : undefined,
    },
  });

  let orchResult = await runOrchestrator(userMessage, buildConfig());
  allTools = collectTools(allTools, orchResult.toolInvocationNames);

  const retryOrchestrator = async (retryBackground: string) => {
    const retryResult = await runOrchestrator(retryBackground, buildConfig());
    allTools = collectTools(allTools, retryResult.toolInvocationNames);
    orchResult = retryResult;
  };

  if (opts.enableDingtalkPreRetries !== false) {
    {
      const initialOutbound = orchResult.messages.join("\n\n");
      if (
        detectFalseScopeSwitch({
          userMessage,
          toolInvocationNames: orchResult.toolInvocationNames ?? [],
          outboundMarkdown: initialOutbound,
        })
      ) {
        await retryOrchestrator(buildScopeSwitchRetryUserMessage(userMessage));
      }
    }

    {
      if (
        detectTopicSwitchWithoutArchive({
          userMessage,
          preTurnLatestDraft: preTurnDraft,
          toolInvocationNames: orchResult.toolInvocationNames ?? [],
        })
      ) {
        await retryOrchestrator(buildTopicSwitchRetryUserMessage(userMessage));
      }
    }

    {
      const initialOutbound = orchResult.messages.join("\n\n");
      if (
        detectDraftClarifyMix({
          message: initialOutbound,
          hasDraft: orchResult.draft !== undefined,
        })
      ) {
        await retryOrchestrator(buildDraftClarifyMixRetryUserMessage(userMessage));
      }
    }
  }

  if (
    opts.allowPublishRetry
    && !publishResultSucceeded(publishResult)
    && !(orchResult.toolInvocationNames ?? []).includes("publish_task")
  ) {
    await retryOrchestrator(buildPublishRetryUserMessage(userMessage, session.planId));
    if (publishResult === undefined && orchResult.publishResult) {
      publishResult = orchResult.publishResult as Record<string, unknown>;
    }
  }

  const draftOutbound = resolveDraftForOutbound({
    preTurnDraft,
    postTurnDraft: session.latestDraft,
    orchResultDraft: orchResult.draft as Record<string, unknown> | undefined,
    toolInvocationNames: orchResult.toolInvocationNames ?? [],
  });
  if (draftOutbound.persistedDraft) {
    session.latestDraft = draftOutbound.persistedDraft as PlanSession["latestDraft"];
  }
  const { draftTouchedThisTurn, draftForRender, persistedDraft } = draftOutbound;

  const taskIds = Array.isArray((persistedDraft as { tasks?: Array<{ id?: string }> } | undefined)?.tasks)
    ? ((persistedDraft as { tasks: Array<{ id?: string }> }).tasks)
        .map((t) => String(t.id ?? "").trim())
        .filter(Boolean)
    : [];

  let assignState = processAssignmentForTurn({
    preTurnDraft,
    persistedDraft: persistedDraft as Record<string, unknown> | undefined,
    sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
    orchAssignment: orchResult.assignment,
    draftTouchedThisTurn,
    planId: session.planId,
    traceId: orchResult.traceId,
    modelName: opts.clientConfig.model,
    taskIds,
    employees: employeeRepo.list().map((e) => ({ userId: e.userId, displayName: e.displayName })),
    candidatePoolUserIds: session.candidatePool?.entries.map((e) => e.userId),
    requireFullCoverage: true,
  });

  const firstPassTools = orchResult.toolInvocationNames ?? [];
  let needsAssignRetry =
    opts.allowAssignRetry !== false
    && process.env.ASSIGNMENT_PHASE_ENABLED === "1"
    && hasAssigneeIntentInUserMessage(userMessage)
    && assignState.coverage.total > 0
    && assignState.coverage.covered < assignState.coverage.total
    && taskIds.length > 0;

  if (
    firstPassTools.includes("bulk_assign_tasks")
    && assignState.coverage.covered === assignState.coverage.total
  ) {
    needsAssignRetry = false;
  }

  if (needsAssignRetry) {
    await retryOrchestrator(
      buildAssignRetryUserMessage({
        originalUserMessage: userMessage,
        missingTaskIds: assignState.missingTaskIds,
        taskIndexMap: buildTaskIndexMap(persistedDraft as Record<string, unknown> | undefined),
      }),
    );
    const retryOutbound = resolveDraftForOutbound({
      preTurnDraft,
      postTurnDraft: session.latestDraft,
      orchResultDraft: orchResult.draft as Record<string, unknown> | undefined,
      toolInvocationNames: orchResult.toolInvocationNames ?? [],
    });
    if (retryOutbound.persistedDraft) {
      session.latestDraft = retryOutbound.persistedDraft as PlanSession["latestDraft"];
    }
    const retryTaskIds = Array.isArray((retryOutbound.persistedDraft as { tasks?: Array<{ id?: string }> } | undefined)?.tasks)
      ? ((retryOutbound.persistedDraft as { tasks: Array<{ id?: string }> }).tasks)
          .map((t) => String(t.id ?? "").trim())
          .filter(Boolean)
      : [];
    assignState = processAssignmentForTurn({
      preTurnDraft,
      persistedDraft: retryOutbound.persistedDraft as Record<string, unknown> | undefined,
      sessionAssignment: session.latestAssignment as Record<string, unknown> | undefined,
      orchAssignment: orchResult.assignment,
      draftTouchedThisTurn: true,
      planId: session.planId,
      traceId: orchResult.traceId,
      modelName: opts.clientConfig.model,
      taskIds: retryTaskIds,
      employees: employeeRepo.list().map((e) => ({ userId: e.userId, displayName: e.displayName })),
      candidatePoolUserIds: session.candidatePool?.entries.map((e) => e.userId),
      requireFullCoverage: true,
    });
  }

  if (assignState.latestAssignment) {
    session.latestAssignment = assignState.latestAssignment as PlanSession["latestAssignment"];
  }

  const outboundMessage = orchResult.messages.join("\n\n");
  session.conversationHistory = [
    ...session.conversationHistory,
    { role: "user" as const, content: userMessage },
    { role: "assistant" as const, content: outboundMessage || "(empty)" },
  ].slice(-12);
  session.updatedAt = new Date().toISOString();

  if (orchResult.publishResult && !publishResult) {
    publishResult = orchResult.publishResult as Record<string, unknown>;
  }

  return {
    traceId: orchResult.traceId,
    tools: allTools,
    messages: orchResult.messages,
    outboundMessage,
    ms: Date.now() - t0,
    hasDraftJson: orchResult.draft !== undefined,
    draftForRender: draftForRender as Record<string, unknown> | undefined,
    persistedDraft: (session.latestDraft ?? persistedDraft) as Record<string, unknown> | undefined,
    assignState,
    publishResult,
    publishOk: publishResultSucceeded(publishResult),
    stopReason: orchResult.stopReason,
  };
}

/** Reject eval user scripts that leak internal tool names (models should discover tools themselves). */
export function assertNaturalUserMessage(message: string): string[] {
  const banned = [
    /\bbulk_assign_tasks\b/i,
    /\bupdate_draft_task\b/i,
    /\bprepare_publish_task\b/i,
    /\bpublish_task\b/i,
    /\bsearch_employees\b/i,
    /\bassignment JSON\b/i,
    /\btaskId\b/i,
    /\btask_id\b/i,
    /\bREDRAFT\b/,
    /\bcandidatePool\b/i,
  ];
  const hits = banned.filter((re) => re.test(message)).map((re) => re.source);
  return hits.length ? [`user message mentions internal tool/id: ${hits.join(", ")}`] : [];
}
