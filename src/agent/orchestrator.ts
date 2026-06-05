import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import {
  MaxToolIterationsExceededError,
  QwenCompatibleClient,
  TokenBudgetExceededError,
} from "./demo/qwen-compatible-client";
import { coerceLlmPlanPayload } from "./demo/llm-schema";
import { buildToolRegistry, type ToolProfile } from "./tools/registry";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";
import {
  buildQwenPlannerSystemPrompt,
  type AgentPromptProfile,
  type QwenPlannerPromptOpts,
} from "./demo/qwen-prompt";
import type { KnownFactsStore } from "./tools/update-known-facts";
import type { PlanSession } from "../infra/plan-session-store";
import type { PublishTaskRecentStore } from "./tools/publish-task";
import { preserveOrchestratorDraftScalars } from "./draft-merge";
import { normalizeDraftTasksForSession } from "./draft-person-fields";
import {
  isDraftStagedForPublish,
  shouldInjectPublishStagingMemoryHint,
} from "./publish-staging";
import {
  buildTurnActionHintLine,
  formatPendingRosterHint,
  formatPublishStagingActionHint,
  formatScopeBoundaryHint,
} from "./orchestrator-turn-hints";
import { stabilizeDraftTaskIds } from "./draft-stabilize";
import { buildTaskIndexMap } from "./assignment/false-assign";
import { assignmentMatchesPlan } from "./assignment/resolve-turn-assignment";

export { shouldInjectExplicitDraftRequestHint } from "./orchestrator-turn-hints";

const MAX_TOOL_ITERATIONS = 6;

export interface OrchestratorConfig {
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  };
  maxToolIterations?: number;
  toolProfile?: ToolProfile;
  promptProfile?: AgentPromptProfile;
  /** When true, inject sixth mode FOLLOWUP + follow-up tool discipline (manager/admin). */
  managerFollowup?: boolean;
  /** When true, append project portfolio tools + prompt (role A only). */
  projectPortfolioEnabled?: boolean;
  trustedActorUserId?: string;
  allowSearchWeb?: boolean;
  knownFactsStore?: KnownFactsStore;
  currentSessionPlanId?: string;
  currentSession?: PlanSession;
  publishRecentStore?: PublishTaskRecentStore;
  actorName?: string;
  actorRole?: "admin" | "manager" | "employee";
  onPublishTaskResult?: (result: Record<string, unknown>) => void;
  /**
   * candidate-pool / read_uploaded_roster_text 工具修改 currentSession 后调用，
   * 让上层（dingtalk-bot / workbench API）即时落盘，避免 orchestrator 中途 crash 后丢失。
   */
  onSessionMutated?: (session: PlanSession) => void;
  sessionContext?: {
    conversationHistory?: Array<{ role: string; content: string }>;
    planId?: string;
    latestDraft?: Record<string, unknown>;
    latestAssignment?: Record<string, unknown>;
    memorySummary?: string;
    memoryFacts?: string[];
    currentTimeIso?: string;
    /**
     * 主管刚上传了花名册但本会话尚未消费时，本字段非空（来源标签 + 字符数）。
     * 不直接灌全文进 prompt，避免每轮重复送大段；模型应调 read_uploaded_roster_text 拿原文。
     */
    pendingRoster?: { sourceLabel: string; chars: number };
    /** 已生效的候选池 brief，供模型自查"我现在能挑哪些人"。 */
    candidatePool?: {
      source: string;
      entries: Array<{ userId: string; displayName: string; fileNotes?: string }>;
      unresolvedCount?: number;
    };
    /**
     * 本轮发生了 scope 切换（start_new_task / switch_back_task / 发布后自动轮转）。
     * orchestrator 会把它渲染成强 memory hint，告知模型禁止引用上一 scope 内容。
     */
    scopeRotatedSinceLastTurn?: { fromLabel?: string; toLabel?: string };
  };
  traceId?: string;
  /** Workbench Excel draft revise only — injects revision discipline into system prompt. */
  workbenchDraftRevision?: boolean;
  /** When true with workbenchDraftRevision, no tools are exposed to the model. */
  disableTools?: boolean;
}

export interface OrchestratorResult {
  messages: string[];
  draft?: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  publishResult?: Record<string, unknown>;
  traceId: string;
  toolCallsTotal: number;
  /** 本次 ReAct 实际执行过的工具名（按调用顺序，含重复）。供 eval / 观测使用。 */
  toolInvocationNames?: string[];
  /** 可观测事件 flags（max turns、draft without json 等）。 */
  observabilityFlags?: string[];
  timing?: {
    totalMs?: number;
    llmMsTotal?: number;
    toolsMsTotal?: number;
    parseMsTotal?: number;
    iterations?: Array<Record<string, unknown>>;
  };
}

export async function runOrchestrator(
  userMessage: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const traceId = config.traceId ?? randomUUID();
  const client = new QwenCompatibleClient(config.clientConfig);

  let savedDraft: Record<string, unknown> | undefined;
  let publishResult: Record<string, unknown> | undefined;
  const previousDraft = config.sessionContext?.latestDraft;

  const toolRegistry = buildToolRegistry({
    employeeRepo: config.employeeRepo,
    toolProfile: config.toolProfile ?? "planner",
    projectPortfolioEnabled: config.projectPortfolioEnabled,
    trustedActorUserId: config.trustedActorUserId,
    allowSearchWeb: config.allowSearchWeb,
    knownFactsStore: config.knownFactsStore,
    currentSessionPlanId: config.currentSessionPlanId,
    currentSession: config.currentSession,
    publishRecentStore: config.publishRecentStore,
    actorName: config.actorName,
    actorRole: config.actorRole,
    orchestratorUserMessage: userMessage,
    onPublishTaskResult: (result: Record<string, unknown>) => {
      publishResult = result;
      config.onPublishTaskResult?.(result);
    },
    onDraftSaved: (draft: Record<string, unknown>) => {
      savedDraft = stabilizeDraftTaskIds(draft, previousDraft);
    },
    onSessionMutated: config.onSessionMutated,
  });

  const tools = config.disableTools
    ? []
    : Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {};
  if (!config.disableTools) {
    for (const [name, entry] of Object.entries(toolRegistry)) {
      handlers[name] = entry.handler;
    }
  }

  // Build messages with conversation history
  const promptOpts: QwenPlannerPromptOpts | undefined =
    config.workbenchDraftRevision
      ? {
          workbenchDraftRevision: true,
          managerFollowup: config.managerFollowup,
          projectPortfolioContext: config.projectPortfolioEnabled,
        }
      : config.managerFollowup || config.projectPortfolioEnabled
        ? {
            managerFollowup: config.managerFollowup,
            projectPortfolioContext: config.projectPortfolioEnabled,
          }
        : undefined;
  const sysPrompt = buildQwenPlannerSystemPrompt(
    config.promptProfile ?? "planner",
    promptOpts,
  );
  const allMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: sysPrompt },
  ];

  const memoryParts: string[] = [];
  if (config.sessionContext?.planId) {
    memoryParts.push(`planId: ${config.sessionContext.planId}`);
  }
  if (config.sessionContext?.memorySummary) {
    memoryParts.push(`memorySummary: ${config.sessionContext.memorySummary}`);
  }
  if (config.sessionContext?.currentTimeIso) {
    memoryParts.push(`currentTime: ${config.sessionContext.currentTimeIso}`);
  }
  const memoryFacts = (config.sessionContext?.memoryFacts ?? []).map((f) => String(f).trim()).filter(Boolean);
  if (memoryFacts.length > 0) {
    memoryParts.push(`topFacts: ${safeJson(memoryFacts.slice(0, 8))}`);
  }
  if (config.sessionContext?.latestDraft) {
    const taskIndexMap = buildTaskIndexMap(config.sessionContext.latestDraft);
    if (taskIndexMap.length > 0) {
      memoryParts.push(`taskIndexMap (表序号→taskId): ${safeJson(taskIndexMap)}`);
    }
    memoryParts.push(
      `latestDraft (未发放草案，权威结构；非已发放正式任务): ${safeJson(serializeDraftForMemory(config.sessionContext.latestDraft))}`,
    );
    memoryParts.push(
      "publishedTasksLookup: 用户问已发放/我管理的正式任务时，必须调 list_managed_tasks 取库内真实数据；不得用 latestDraft 充数。",
    );
  }
  if (
    config.sessionContext?.latestAssignment
    && assignmentMatchesPlan(config.sessionContext.latestAssignment, config.sessionContext.planId ?? "")
  ) {
    memoryParts.push(
      `latestAssignmentSummary: ${safeJson(summarizeAssignmentForPrompt(config.sessionContext.latestAssignment))}`,
    );
  }
  if (config.sessionContext?.pendingRoster) {
    memoryParts.push(formatPendingRosterHint(config.sessionContext.pendingRoster));
  }
  if (config.sessionContext?.scopeRotatedSinceLastTurn) {
    memoryParts.push(formatScopeBoundaryHint(config.sessionContext.scopeRotatedSinceLastTurn));
  }
  if (config.sessionContext?.candidatePool) {
    memoryParts.push(`candidatePool: ${safeJson(config.sessionContext.candidatePool)}`);
  }
  if (
    shouldInjectPublishStagingMemoryHint({
      userMessage,
      latestDraft: config.sessionContext?.latestDraft,
    })
  ) {
    const staged = isDraftStagedForPublish(config.sessionContext?.latestDraft);
    memoryParts.push(formatPublishStagingActionHint(staged));
  }
  const turnActionHint = buildTurnActionHintLine(config.sessionContext, userMessage);
  if (turnActionHint) {
    memoryParts.push(turnActionHint);
  }
  if (memoryParts.length > 0) {
    allMessages.push({
      role: "assistant",
      content: `[memory_context]\n${memoryParts.join("\n")}`,
    });
  }

  const history = normalizeConversationHistoryForModel(
    config.sessionContext?.conversationHistory ?? [],
  );
  const historyWindowRaw = Number(process.env.AGENT_HISTORY_TURNS ?? "6");
  const historyWindow = Number.isFinite(historyWindowRaw) && historyWindowRaw > 0
    ? Math.floor(historyWindowRaw)
    : 10;
  for (const h of history.slice(-historyWindow)) {
    allMessages.push(h);
  }
  allMessages.push({ role: "user", content: userMessage });

  const maxToolIterations = Math.max(1, config.maxToolIterations ?? MAX_TOOL_ITERATIONS);
  let response;
  try {
    response = await client.callWithTools({
      traceId,
      messages: allMessages,
      tools,
      toolHandlers: handlers,
      maxIterations: maxToolIterations,
      maxTotalMs: Number(process.env.AGENT_MAX_TOTAL_MS ?? "120000"),
      maxToolCalls: Number(process.env.AGENT_MAX_TOOL_CALLS ?? "12"),
      maxTotalTokens: Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "24000"),
    });
  } catch (err) {
    if (err instanceof MaxToolIterationsExceededError || err instanceof TokenBudgetExceededError) {
      const toolNames = err.iterationTimings.flatMap((it) =>
        (it.tools ?? []).map((t) => t.toolName),
      );
      let salvagedDraft: Record<string, unknown> | undefined = savedDraft;
      let salvagedMessage = err.lastAssistantContent.trim();
      if (salvagedMessage && !salvagedDraft) {
        try {
          const parsed = JSON.parse(salvagedMessage) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            if (isPlainObject(parsed.draft)) {
              salvagedDraft = normalizeDraftTasksForSession(
                stabilizeDraftTaskIds(
                  coerceLlmPlanPayload(parsed.draft) as unknown as Record<string, unknown>,
                  previousDraft,
                ),
              );
            }
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              salvagedMessage = parsed.message.trim();
            }
          }
        } catch {
          // 不是 JSON，直接作为自然语言抢救输出
        }
      }
      const eventName = err instanceof TokenBudgetExceededError
        ? "orchestrator_token_budget_exceeded"
        : "orchestrator_max_turns_exceeded";
      logStructured({
        event: eventName,
        traceId,
        maxToolIterations,
        reason: err.message,
        toolCallsExecuted: err.toolCallsExecuted,
        toolInvocationNames: toolNames,
        hasPartialDraft: salvagedDraft !== undefined,
        hasSalvagedMessage: salvagedMessage.length > 0,
        stagedForPublish: salvagedDraft ? isDraftStagedForPublish(salvagedDraft) : false,
      });
      const fallbackMessage = buildOrchestratorInterruptMessage({
        userMessage,
        salvagedMessage,
        hasPartialDraft: salvagedDraft !== undefined,
        stagedForPublish: salvagedDraft ? isDraftStagedForPublish(salvagedDraft) : false,
        tokenBudgetExceeded: err instanceof TokenBudgetExceededError,
      });
      return {
        messages: [fallbackMessage],
        draft: salvagedDraft,
        assignment: undefined,
        publishResult,
        traceId,
        toolCallsTotal: err.toolCallsExecuted,
        toolInvocationNames: toolNames,
        observabilityFlags: [eventName],
      };
    }
    throw err;
  }

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;
  const timing = response.timing;
  const toolInvocationNames =
    timing?.iterations?.flatMap((it) => (it.tools ?? []).map((t) => t.toolName)) ?? [];

  const msg = String(payload?.message ?? "").trim();
  let assignment = isPlainObject(payload?.assignment) ? payload?.assignment as Record<string, unknown> : undefined;

  const messages: string[] = msg ? [msg] : [];
  const rawDraft = isPlainObject(payload?.draft) ? payload.draft : undefined;
  const payloadDraft = rawDraft
    ? preserveOrchestratorDraftScalars(
        rawDraft,
        coerceLlmPlanPayload(rawDraft) as unknown as Record<string, unknown>,
      )
    : undefined;
  let draft: Record<string, unknown> | undefined = savedDraft ?? payloadDraft;
  if (draft) {
    draft = normalizeDraftTasksForSession(stabilizeDraftTaskIds(draft, previousDraft));
  }
  if (assignment && draft) {
    assignment = alignAssignmentTaskIds(assignment, draft);
  }

  const draftLikeMessageWithoutJson =
    !draft && msg.length > 0 && looksLikeDraftStyleMessage(msg);
  const observabilityFlags: string[] = [];
  if (draftLikeMessageWithoutJson) {
    observabilityFlags.push("orchestrator_draft_message_without_json");
    logStructured({
      event: "orchestrator_draft_message_without_json",
      traceId,
      messageChars: msg.length,
      messagePreview: msg.slice(0, 200),
    });
  }

  logStructured({
    event: "orchestrator_done",
    traceId,
    toolCallsTotal,
    llmMsTotal: timing?.llmMsTotal ?? null,
    toolsMsTotal: timing?.toolsMsTotal ?? null,
    parseMsTotal: timing?.parseMsTotal ?? null,
    orchestratorLoopMs: timing?.totalMs ?? null,
    loopIterations: timing?.iterations?.length ?? null,
    hasDraft: draft !== undefined,
    hasAssignment: assignment !== undefined,
    hasPublishResult: publishResult !== undefined,
    messageChars: msg.length,
    messagePreview: msg.slice(0, 200),
    draftLikeMessageWithoutJson,
  });

  return {
    messages,
    draft,
    assignment,
    publishResult,
    traceId,
    toolCallsTotal,
    toolInvocationNames,
    timing,
    observabilityFlags: observabilityFlags.length ? observabilityFlags : undefined,
  };
}

function safeJson(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeDraftStyleMessage(message: string): boolean {
  const text = String(message ?? "");
  return /已采纳要点|拆解逻辑|阅读导览/.test(text);
}

function serializeDraftForMemory(draft: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeDraftTasksForSession(draft);
  const maxChars = Number(process.env.ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS ?? "12000");
  const cap = Number.isFinite(maxChars) && maxChars > 500 ? Math.floor(maxChars) : 32000;
  const full = JSON.stringify(normalized);
  if (full.length <= cap) return normalized;

  const tasks = Array.isArray((normalized as { tasks?: unknown[] }).tasks)
    ? ((normalized as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const slimTasks = tasks.map((t) => ({
    id: String(t?.id ?? ""),
    title: String(t?.title ?? "").slice(0, 120),
    objective: String(t?.objective ?? "").slice(0, 200),
    timeNode: (t?.timeNode as Record<string, unknown> | undefined)?.dueAt
      ? { dueAt: String((t.timeNode as Record<string, unknown>).dueAt ?? "") }
      : undefined,
  }));
  const slim: Record<string, unknown> = {
    _truncated: true,
    title: normalized.title,
    description: typeof normalized.description === "string"
      ? (normalized.description as string).slice(0, 500)
      : normalized.description,
    classification: (normalized as { classification?: unknown }).classification,
    tasks: slimTasks,
  };
  const slimJson = JSON.stringify(slim);
  if (slimJson.length <= cap) return slim;
  return {
    _truncated: true,
    title: normalized.title,
    taskCount: tasks.length,
    taskIds: slimTasks.map((t) => t.id),
  };
}

function summarizeAssignmentForPrompt(
  assignment: Record<string, unknown>,
): Record<string, unknown> {
  const assignments = Array.isArray((assignment as { assignments?: unknown[] }).assignments)
    ? (assignment as { assignments: Array<Record<string, unknown>> }).assignments
    : [];
  return {
    hasAssignment: true,
    taskIds: assignments
      .map((a) => String(a?.taskId ?? "").trim())
      .filter((id) => id.length > 0)
      .slice(0, 8),
  };
}

function alignAssignmentTaskIds(
  assignment: Record<string, unknown>,
  draft: Record<string, unknown>,
): Record<string, unknown> {
  const assignments = Array.isArray((assignment as { assignments?: unknown[] }).assignments)
    ? (assignment as { assignments: Array<Record<string, unknown>> }).assignments
    : [];
  const draftTasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? (draft as { tasks: Array<Record<string, unknown>> }).tasks
    : [];
  const draftIds = draftTasks.map((t) => String(t?.id ?? "").trim()).filter(Boolean);
  const normalized = assignments.map((row, index) => {
    const taskId = String(row?.taskId ?? "").trim();
    if (taskId) return row;
    return {
      ...row,
      taskId: draftIds[index] ?? `task_${index + 1}`,
    };
  });
  return { ...assignment, assignments: normalized };
}

function normalizeConversationHistoryForModel(
  history: Array<{ role: string; content: string }>,
): Array<{ role: "user" | "assistant"; content: string }> {
  const normalized: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const row of history) {
    const content = String(row?.content ?? "").trim();
    if (!content) continue;
    if (row.role === "user" || row.role === "assistant") {
      normalized.push({ role: row.role, content });
      continue;
    }
    // Some subsystems (e.g. workbench updates) persist custom roles like employee_update.
    // Map them to assistant message to keep context while preserving OpenAI-compatible roles.
    normalized.push({ role: "assistant", content: `[${row.role}] ${content}` });
  }
  return normalized;
}

/**
 * 编排轮次用尽 / token 预算触顶时的用户可见说明：必须是「技术性中断」，不得伪装成「用户未提供信息」。
 */
function buildOrchestratorInterruptMessage(input: {
  userMessage: string;
  salvagedMessage: string;
  hasPartialDraft: boolean;
  stagedForPublish: boolean;
  tokenBudgetExceeded: boolean;
}): string {
  if (input.salvagedMessage) return input.salvagedMessage;
  if (input.stagedForPublish) {
    return (
      "**发放预检已完成**（尚未正式发放）。请核对下方任务表与负责人；确认无误后回复「**确认发放**」。"
    );
  }
  const preview = input.userMessage.trim().slice(0, 400);
  const reason = input.tokenBudgetExceeded
    ? "本轮对话 token 预算已用尽"
    : "本轮已达到编排工具轮次上限";
  const parts = [
    `**说明**：${reason}（模型在多轮工具调用后仍未给出最终 JSON）。这是**流程中断**，不是你没有提供信息。`,
  ];
  if (input.hasPartialDraft) {
    parts.push(
      "已通过工具暂存了**部分草案**；请在下一条直接发「**继续**」或「**继续生成草案**」，我会在同一会话里接着补全。",
    );
  } else {
    parts.push("请在下一条发「**继续**」，或把需求再简述一次，我会重新编排。");
  }
  if (preview.length > 0) {
    parts.push(
      "",
      `你刚发送的内容（节选）：${preview}${input.userMessage.trim().length > 400 ? "…" : ""}`,
    );
  }
  return parts.join("\n\n");
}
