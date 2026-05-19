import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import {
  MaxToolIterationsExceededError,
  QwenCompatibleClient,
} from "./demo/qwen-compatible-client";
import { buildToolRegistry, type ToolProfile } from "./tools/registry";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";
import { buildQwenPlannerSystemPrompt, type AgentPromptProfile } from "./demo/qwen-prompt";
import {
  extractStructuredDraftFromMessage,
  looksLikeTaskDraftMessage,
  readDraftFallbackEnabled,
} from "./demo/draft-fallback-extract";
import { synthesizeMessageFromDraft } from "./orchestrator-draft-message";
import { shouldInjectCandidatePoolMemoryHint } from "./planning-phase";
import type { KnownFactsStore } from "./tools/update-known-facts";
import type { PlanSession } from "../infra/plan-session-store";
import type { PublishTaskRecentStore } from "./tools/publish-task";

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
      entries: Array<{ userId: string; displayName: string }>;
      unresolvedCount?: number;
    };
  };
  traceId?: string;
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
    trustedActorUserId: config.trustedActorUserId,
    allowSearchWeb: config.allowSearchWeb,
    knownFactsStore: config.knownFactsStore,
    currentSessionPlanId: config.currentSessionPlanId,
    currentSession: config.currentSession,
    publishRecentStore: config.publishRecentStore,
    actorName: config.actorName,
    actorRole: config.actorRole,
    onPublishTaskResult: (result: Record<string, unknown>) => {
      publishResult = result;
      config.onPublishTaskResult?.(result);
    },
    onDraftSaved: (draft: Record<string, unknown>) => {
      savedDraft = stabilizeDraftTaskIds(draft, previousDraft);
    },
    onSessionMutated: config.onSessionMutated,
  });

  const tools = Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {};
  for (const [name, entry] of Object.entries(toolRegistry)) {
    handlers[name] = entry.handler;
  }

  // Build messages with conversation history
  const sysPrompt = buildQwenPlannerSystemPrompt(config.promptProfile ?? "planner");
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
    memoryParts.push(`latestDraftSummary: ${safeJson(summarizeDraftForPrompt(config.sessionContext.latestDraft))}`);
  }
  if (config.sessionContext?.latestAssignment) {
    memoryParts.push(
      `latestAssignmentSummary: ${safeJson(summarizeAssignmentForPrompt(config.sessionContext.latestAssignment))}`,
    );
  }
  if (config.sessionContext?.pendingRoster) {
    memoryParts.push(
      `pendingRoster: ${safeJson(config.sessionContext.pendingRoster)} | ACTION_REQUIRED: 调 match_roster_to_contacts（fromPendingRoster=true，默认写 candidatePool）；禁止对名单每人 search_employees。unresolved 在 message 反问主管消歧。`,
    );
  }
  if (
    config.sessionContext?.candidatePool
    && shouldInjectCandidatePoolMemoryHint({
      userMessage,
      hasLatestDraft: Boolean(config.sessionContext?.latestDraft),
      hasPendingRoster: Boolean(config.sessionContext?.pendingRoster),
      hasCandidatePool: true,
    })
  ) {
    memoryParts.push(
      `candidatePool: ${safeJson(config.sessionContext.candidatePool)} | 本 plan 的指派只能在 entries[*].userId 中选；search_employees 已自动收窄到池内。`,
    );
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
  const historyWindowRaw = Number(process.env.AGENT_HISTORY_TURNS ?? "10");
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
      maxTotalTokens: Number(process.env.AGENT_MAX_TOTAL_TOKENS ?? "12000"),
    });
  } catch (err) {
    if (err instanceof MaxToolIterationsExceededError) {
      // 抢救：把客户端记录的工具序列 / 已经"溢出"的中间内容 / 上次会话草案，统一回填给上层，
      // 避免用户看到一句空洞的"流程中断"。
      const toolNames = err.iterationTimings.flatMap((it) =>
        (it.tools ?? []).map((t) => t.toolName),
      );
      // 模型若在最后一轮 inline 给了内容，且能解析出 draft，就把 draft 抢救出来
      // prepare_publish_task 在 max-iter 前已把规整后 draft 暂存到 session.latestDraft——也要兜底
      const sessionStagedDraft =
        isPlainObject(config.currentSession?.latestDraft)
          ? (config.currentSession!.latestDraft as Record<string, unknown>)
          : undefined;
      let salvagedDraft: Record<string, unknown> | undefined =
        savedDraft ?? sessionStagedDraft;
      let salvagedMessage = err.lastAssistantContent.trim();
      if (salvagedMessage && !salvagedDraft) {
        try {
          const parsed = JSON.parse(salvagedMessage) as Record<string, unknown>;
          if (parsed && typeof parsed === "object") {
            if (isPlainObject(parsed.draft)) {
              salvagedDraft = stabilizeDraftTaskIds(
                parsed.draft as Record<string, unknown>,
                previousDraft,
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
      logStructured({
        event: "orchestrator_max_turns_exceeded",
        traceId,
        maxToolIterations,
        reason: err.message,
        toolCallsExecuted: err.toolCallsExecuted,
        toolInvocationNames: toolNames,
        hasPartialDraft: salvagedDraft !== undefined,
        hasSalvagedMessage: salvagedMessage.length > 0,
      });
      let fallbackMessage = salvagedMessage;
      if (!fallbackMessage && salvagedDraft) {
        fallbackMessage = synthesizeMessageFromDraft(salvagedDraft);
      }
      if (!fallbackMessage) {
        fallbackMessage = buildOrchestratorIterationLimitMessage(userMessage, {
          hasPartialDraft: salvagedDraft !== undefined,
        });
      }
      return {
        messages: [fallbackMessage],
        draft: salvagedDraft,
        assignment: undefined,
        publishResult,
        traceId,
        toolCallsTotal: err.toolCallsExecuted,
        toolInvocationNames: toolNames,
      };
    }
    throw err;
  }

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;
  const timing = response.timing;
  const toolInvocationNames =
    timing?.iterations?.flatMap((it) => (it.tools ?? []).map((t) => t.toolName)) ?? [];

  let msg = String(
    (payload as Record<string, unknown> | undefined)?.message
    ?? (payload as Record<string, unknown> | undefined)?.assistantMessage
    ?? "",
  ).trim();
  let assignment = isPlainObject(payload?.assignment) ? payload?.assignment as Record<string, unknown> : undefined;

  const payloadDraft = isPlainObject(payload?.draft)
    ? (payload.draft as Record<string, unknown>)
    : undefined;
  let draft: Record<string, unknown> | undefined = savedDraft ?? payloadDraft;
  if (draft) {
    draft = stabilizeDraftTaskIds(draft, previousDraft);
  }

  // 模型常把 token 全塞进 draft 导致 message 为空；补一段短摘要，避免钉钉只显示空行+表
  if (draft && !msg) {
    msg = synthesizeMessageFromDraft(draft);
    logStructured({
      event: "orchestrator_message_synthesized_from_draft",
      traceId,
      title: String((draft as { title?: unknown }).title ?? "").slice(0, 80),
    });
  }

  const messages: string[] = msg ? [msg] : [];

  const fallbackStartedAt = Date.now();
  let draftFallbackOutcome: "skipped" | "triggered_ok" | "triggered_failed" = "skipped";
  if (!draft && readDraftFallbackEnabled() && msg && looksLikeTaskDraftMessage(msg)) {
    draftFallbackOutcome = "triggered_failed";
    const fallbackDraft =
      (await extractStructuredDraftFromMessage({
        message: msg,
        modelConfig: {
          apiKey: config.clientConfig.apiKey,
          baseUrl: config.clientConfig.baseUrl,
          timeoutMs: config.clientConfig.timeoutMs,
        },
        traceId,
      })) ?? undefined;
    const fbTasks = Array.isArray((fallbackDraft as { tasks?: unknown[] })?.tasks)
      ? (fallbackDraft as { tasks: unknown[] }).tasks
      : [];
    if (fallbackDraft && fbTasks.length > 0) {
      draft = stabilizeDraftTaskIds(
        fallbackDraft as unknown as Record<string, unknown>,
        previousDraft,
      );
      draftFallbackOutcome = "triggered_ok";
    }
  }
  if (draftFallbackOutcome === "triggered_ok" || draftFallbackOutcome === "triggered_failed") {
    logStructured({
      event: "draft_fallback_extracted",
      traceId,
      outcome: draftFallbackOutcome,
      taskCount: Array.isArray((draft as { tasks?: unknown[] })?.tasks)
        ? (draft as { tasks: unknown[] }).tasks.length
        : 0,
      llmMs: Date.now() - fallbackStartedAt,
    });
  }

  if (assignment && draft) {
    assignment = alignAssignmentTaskIds(assignment, draft);
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
  });

  return {
    messages,
    draft,
    assignment,
    publishResult,
    traceId,
    toolCallsTotal,
    toolInvocationNames,
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

function summarizeDraftForPrompt(draft: Record<string, unknown>): Record<string, unknown> {
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const taskTitles = tasks
    .map((t) => String(t?.title ?? "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 5);
  return {
    hasDraft: true,
    taskTitles,
    title: String((draft as { title?: unknown }).title ?? "").trim() || null,
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

function stabilizeDraftTaskIds(
  draft: Record<string, unknown>,
  previous?: Record<string, unknown>,
): Record<string, unknown> {
  const tasks = Array.isArray((draft as { tasks?: unknown[] }).tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  if (tasks.length === 0) return draft;
  const previousTasks = Array.isArray((previous as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((previous as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const byFingerprint = new Map<string, string>();
  for (const task of previousTasks) {
    const id = String(task?.id ?? "").trim();
    if (!id) continue;
    byFingerprint.set(fingerprintTask(task), id);
  }
  const used = new Set<string>();
  const nextTasks = tasks.map((task, index) => {
    const cloned = { ...task };
    let id = String(cloned.id ?? "").trim();
    if (!id) {
      const prevAtIndex = previousTasks[index];
      const prevId = String(prevAtIndex?.id ?? "").trim();
      if (prevId) {
        id = prevId;
      } else {
        id = byFingerprint.get(fingerprintTask(cloned)) ?? "";
      }
    }
    if (!id || used.has(id)) {
      id = allocTaskId(index, used);
    }
    used.add(id);
    cloned.id = id;
    return cloned;
  });
  return { ...draft, tasks: nextTasks };
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

function fingerprintTask(task: Record<string, unknown>): string {
  const title = String(task?.title ?? "").trim().toLowerCase();
  const objective = String(task?.objective ?? "").trim().toLowerCase();
  return `${title}::${objective}`;
}

function allocTaskId(index: number, used: Set<string>): string {
  const base = `task_${index + 1}`;
  if (!used.has(base)) return base;
  let seq = index + 1;
  while (used.has(`task_${seq}`)) seq += 1;
  return `task_${seq}`;
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
 * 编排轮次用尽时的用户可见说明：必须是「技术性中断」，不得伪装成「用户未提供信息」，
 * 否则会在用户已补充答案时表现为「失忆」。
 */
function buildOrchestratorIterationLimitMessage(
  userMessage: string,
  options: { hasPartialDraft: boolean },
): string {
  const preview = userMessage.trim().slice(0, 400);
  const parts = [
    "**说明**：本轮已达到编排工具轮次上限（模型在多轮工具调用后仍未给出最终 JSON）。这是**流程中断**，不是你没有提供信息。",
  ];
  if (options.hasPartialDraft) {
    parts.push(
      "已通过工具暂存了**部分草案**；请在下一条直接发「**继续**」或「**继续生成草案**」，我会在同一会话里接着补全。",
    );
  } else {
    parts.push("请在下一条发「**继续**」，或把需求再简述一次，我会重新编排。");
  }
  if (preview.length > 0) {
    parts.push(
      "",
      `你刚发送的内容（节选）：${preview}${userMessage.trim().length > 400 ? "…" : ""}`,
    );
  }
  return parts.join("\n\n");
}
