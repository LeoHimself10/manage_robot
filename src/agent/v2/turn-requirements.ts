import {
  buildAssignRetryUserMessage,
  buildTaskIndexMap,
} from "../assignment/false-assign";
import {
  buildSplitRetryUserMessage,
  detectFalseSplit,
  draftTaskCount,
} from "../draft-mutation/false-split";
import {
  buildPublishRetryUserMessage,
  buildScopeSwitchRetryUserMessage,
  detectFalseScopeSwitch,
  isPublishConfirmUserMessage,
} from "../publish-staging";
import { publishResultSucceeded } from "../publish-helpers";
import {
  hasAssigneeIntentInUserMessage,
  hasDeadlineInContext,
  hasRowPatchIntentInUserMessage,
  hasWholeTableRedraftIntentInUserMessage,
  isGenuineClarifyAssistantMessage,
  shouldInjectExplicitDraftRequestHint,
  shouldInjectPostClarifyDraftHint,
} from "../orchestrator-turn-hints";
import { DRAFT_MUTATING_TOOL_NAMES } from "../../view/draft-outbound";
import type { PlanSession } from "../../infra/plan-session-store";
import type { V2GraphRunResult } from "./graph";
import { isRetryKindBlockedByGate, type RetryKind } from "./turn-contract";

export interface V2RetryOpts {
  allowAssignRetry?: boolean;
  allowPublishRetry?: boolean;
  allowSplitRetry?: boolean;
}

export interface PickV2RetryInput {
  userMessage: string;
  session: PlanSession;
  preTurnDraft?: Record<string, unknown>;
  persistedDraft?: Record<string, unknown>;
  toolInvocationNames: readonly string[];
  outboundMarkdown: string;
  publishResult?: Record<string, unknown>;
  assignCoverage: { total: number; covered: number };
  missingTaskIds: string[];
  retryOpts?: V2RetryOpts;
  /** Rule 1: gate reason from the first-run decideTurnToolChoice. Incompatible retry kinds are skipped. */
  gateReason?: string;
}

export interface PickV2RetryResult {
  message: string;
  kind: RetryKind;
}

function hasDraftMutatingTools(toolNames: readonly string[]): boolean {
  return toolNames.some((n) => DRAFT_MUTATING_TOOL_NAMES.has(n) || n === "replace_draft");
}

function lastAssistantMessage(
  history: Array<{ role: string; content: string }> | undefined,
): string {
  if (!history?.length) return "";
  const last = [...history].reverse().find((h) => h.role === "assistant");
  return String(last?.content ?? "").trim();
}

function readV2DraftRetryMinTasks(): number {
  const raw = Number(process.env.V2_DRAFT_RETRY_MIN_TASKS ?? "4");
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 4;
}

export function hasRosterOrPoolContext(session: PlanSession): boolean {
  return Boolean(
    session.pendingRosterText?.trim()
    || (session.candidatePool?.entries?.length ?? 0) > 0,
  );
}

export function detectV2MissingDraftMutation(input: {
  userMessage: string;
  session: PlanSession;
  preTurnDraft?: Record<string, unknown>;
  postTurnDraft?: Record<string, unknown>;
  toolInvocationNames: readonly string[];
}): boolean {
  if (hasDraftMutatingTools(input.toolInvocationNames)) return false;

  const preCount = draftTaskCount(input.preTurnDraft);
  const postCount = draftTaskCount(input.postTurnDraft);
  const minTasks = readV2DraftRetryMinTasks();

  const sessionContext = {
    conversationHistory: input.session.conversationHistory,
    latestDraft: input.preTurnDraft ?? (input.session.latestDraft as Record<string, unknown> | undefined),
    memoryFacts: input.session.knownFacts,
  };

  if (shouldInjectPostClarifyDraftHint(sessionContext, input.userMessage)) {
    return true;
  }

  const lastAssistant = lastAssistantMessage(input.session.conversationHistory);
  const postClarifySupplement =
    isGenuineClarifyAssistantMessage(lastAssistant)
    && hasDeadlineInContext(input.userMessage, input.session.knownFacts)
    && input.userMessage.trim().length >= 80
    && (postCount < minTasks || (preCount === 0 && postCount === 0));
  if (postClarifySupplement) {
    return true;
  }

  if (postCount > preCount) return false;

  if (hasWholeTableRedraftIntentInUserMessage(input.userMessage)) {
    return true;
  }
  if (
    shouldInjectExplicitDraftRequestHint(input.userMessage)
    && hasDeadlineInContext(input.userMessage, input.session.knownFacts)
    && postCount === 0
  ) {
    return true;
  }

  return false;
}

export function detectV2MissingPatch(input: {
  userMessage: string;
  toolInvocationNames: readonly string[];
}): boolean {
  if (!hasRowPatchIntentInUserMessage(input.userMessage)) return false;
  if (hasWholeTableRedraftIntentInUserMessage(input.userMessage)) return false;
  const tools = input.toolInvocationNames;
  if (tools.includes("update_draft_task") || tools.includes("bulk_assign_tasks")) {
    return false;
  }
  return true;
}

export function buildV2PatchRetryUserMessage(input: {
  originalUserMessage: string;
  taskIndexMap?: Array<{ n: number; id: string; title: string }>;
}): string {
  const mapLine =
    input.taskIndexMap?.length
      ? `taskIndexMap: ${JSON.stringify(input.taskIndexMap)}`
      : "";
  return [
    "[patch_retry_required]",
    "须 update_draft_task 改 dueAt/字段；改负责人须 bulk_assign_tasks。",
    mapLine,
    "禁止 replace_draft 整表重出。",
    "",
    input.originalUserMessage,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildV2DraftRetryUserMessage(originalUserMessage: string): string {
  return [
    "[draft_tool_required]",
    "你刚才只在 message 里描述了草案变更，但未调用 replace_draft / add_draft_subtask / update_draft_task。",
    "请立刻用工具写入 session：整表 WBS → replace_draft；单行拆分 → update_draft_task + add_draft_subtask；单点改字段 → update_draft_task。",
    "禁止只口播不出工具结果。",
    "",
    originalUserMessage,
  ].join("\n");
}

export function needsV2PublishRetry(input: PickV2RetryInput): boolean {
  if (input.retryOpts?.allowPublishRetry === false) return false;
  if (publishResultSucceeded(input.publishResult)) return false;
  if (!isPublishConfirmUserMessage(input.userMessage)) return false;
  if (input.toolInvocationNames.includes("publish_task")) return false;
  return true;
}

export function needsV2RosterAssignRetry(input: PickV2RetryInput): boolean {
  if (process.env.ASSIGNMENT_PHASE_ENABLED !== "1") return false;
  if (input.retryOpts?.allowAssignRetry === false) return false;
  if (!hasRosterOrPoolContext(input.session)) return false;
  if (!hasAssigneeIntentInUserMessage(input.userMessage)) return false;
  if (input.assignCoverage.total === 0) return false;
  if (input.assignCoverage.covered >= input.assignCoverage.total) return false;
  if (
    input.toolInvocationNames.includes("bulk_assign_tasks")
    && input.assignCoverage.covered >= input.assignCoverage.total
  ) {
    return false;
  }
  return true;
}

export function buildV2RosterAssignRetryUserMessage(input: {
  originalUserMessage: string;
  missingTaskIds: string[];
  taskIndexMap?: Array<{ n: number; id: string; title: string }>;
}): string {
  const base = buildAssignRetryUserMessage(input);
  return base.replace(
    "[assign_retry_required]",
    "[roster_assign_retry_required]\n已有 candidatePool 时禁止逐条 search；须 bulk_assign_tasks 一次覆盖全部 taskId。",
  );
}

export function needsV2AssignRetry(input: PickV2RetryInput): boolean {
  if (needsV2RosterAssignRetry(input)) return false;
  if (process.env.ASSIGNMENT_PHASE_ENABLED !== "1") return false;
  if (input.retryOpts?.allowAssignRetry === false) return false;
  if (!hasAssigneeIntentInUserMessage(input.userMessage)) return false;
  if (input.assignCoverage.total === 0) return false;
  return input.assignCoverage.covered < input.assignCoverage.total;
}

/**
 * Pick at most one retry by priority (scope > rosterAssign > publish > split > patch > draft > assign).
 * Returns `{message, kind}` so callers can look up the matching RETRY_KIND_GATE (Rule 2) and apply
 * the skip matrix (Rule 1) via isRetryKindBlockedByGate.
 */
export function pickV2Retry(input: PickV2RetryInput): PickV2RetryResult | undefined {
  const gateReason = input.gateReason ?? "";

  const blocked = (kind: RetryKind): boolean =>
    gateReason ? isRetryKindBlockedByGate(kind, gateReason) : false;

  if (
    detectFalseScopeSwitch({
      userMessage: input.userMessage,
      toolInvocationNames: input.toolInvocationNames,
      outboundMarkdown: input.outboundMarkdown,
    })
    && !blocked("scope_switch")
  ) {
    return {
      message: buildScopeSwitchRetryUserMessage(input.userMessage),
      kind: "scope_switch",
    };
  }

  if (needsV2RosterAssignRetry(input) && !blocked("roster_assign")) {
    return {
      message: buildV2RosterAssignRetryUserMessage({
        originalUserMessage: input.userMessage,
        missingTaskIds: input.missingTaskIds,
        taskIndexMap: buildTaskIndexMap(input.persistedDraft),
      }),
      kind: "roster_assign",
    };
  }

  if (needsV2PublishRetry(input) && !blocked("publish")) {
    return {
      message: buildPublishRetryUserMessage(input.userMessage, input.session.planId),
      kind: "publish",
    };
  }

  if (
    input.retryOpts?.allowSplitRetry !== false
    && !blocked("split")
    && detectFalseSplit({
      userMessage: input.userMessage,
      preTurnDraft: input.preTurnDraft,
      postTurnDraft: input.persistedDraft,
      outboundMarkdown: input.outboundMarkdown,
      toolInvocationNames: input.toolInvocationNames,
      orchResultHasDraftJson: false,
    })
  ) {
    return {
      message: buildSplitRetryUserMessage({
        originalUserMessage: input.userMessage,
        taskIndexMap: buildTaskIndexMap(input.persistedDraft),
      }),
      kind: "split",
    };
  }

  if (
    !blocked("patch")
    && detectV2MissingPatch({
      userMessage: input.userMessage,
      toolInvocationNames: input.toolInvocationNames,
    })
  ) {
    return {
      message: buildV2PatchRetryUserMessage({
        originalUserMessage: input.userMessage,
        taskIndexMap: buildTaskIndexMap(input.persistedDraft),
      }),
      kind: "patch",
    };
  }

  if (
    !blocked("draft")
    && detectV2MissingDraftMutation({
      userMessage: input.userMessage,
      session: input.session,
      preTurnDraft: input.preTurnDraft,
      postTurnDraft: input.persistedDraft,
      toolInvocationNames: input.toolInvocationNames,
    })
  ) {
    return {
      message: buildV2DraftRetryUserMessage(input.userMessage),
      kind: "draft",
    };
  }

  if (!blocked("assign") && needsV2AssignRetry(input)) {
    return {
      message: buildAssignRetryUserMessage({
        originalUserMessage: input.userMessage,
        missingTaskIds: input.missingTaskIds,
        taskIndexMap: buildTaskIndexMap(input.persistedDraft),
      }),
      kind: "assign",
    };
  }

  return undefined;
}

/** @deprecated Use pickV2Retry and extract `.message`. Kept for backward compat. */
export function pickV2RetryUserMessage(input: PickV2RetryInput): string | undefined {
  return pickV2Retry(input)?.message;
}

export function mergeV2GraphResults(
  first: V2GraphRunResult,
  second: V2GraphRunResult,
): V2GraphRunResult {
  const publishResult = publishResultSucceeded(second.publishResult)
    ? second.publishResult
    : publishResultSucceeded(first.publishResult)
      ? first.publishResult
      : second.publishResult ?? first.publishResult;

  const observabilityFlags = [
    ...first.observabilityFlags,
    ...second.observabilityFlags,
    "v2_turn_requirement_retry",
  ];

  return {
    traceId: second.traceId,
    finalMessage: second.finalMessage || first.finalMessage,
    toolInvocationNames: [...first.toolInvocationNames, ...second.toolInvocationNames],
    toolCallsTotal: first.toolCallsTotal + second.toolCallsTotal,
    publishResult,
    observabilityFlags,
    timing: {
      totalMs: first.timing.totalMs + second.timing.totalMs,
      llmMsTotal: first.timing.llmMsTotal + second.timing.llmMsTotal,
      toolsMsTotal: first.timing.toolsMsTotal + second.timing.toolsMsTotal,
      iterations: [...first.timing.iterations, ...second.timing.iterations],
    },
  };
}
