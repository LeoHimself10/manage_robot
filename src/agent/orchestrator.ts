import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
import { buildToolRegistry } from "./tools/registry";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";
import { buildQwenPlannerSystemPrompt } from "./demo/qwen-prompt";

const MAX_TOOL_ITERATIONS = 6;

export interface OrchestratorConfig {
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: { list(): EmployeeProfileRecord[] };
  maxToolIterations?: number;
  sessionContext?: {
    knownFacts?: string[];
    conversationHistory?: Array<{ role: string; content: string }>;
    planId?: string;
    latestDraft?: Record<string, unknown>;
    latestAssignment?: Record<string, unknown>;
    memorySummary?: string;
  };
  traceId?: string;
}

export interface OrchestratorResult {
  messages: string[];
  draft?: Record<string, unknown>;
  assignment?: Record<string, unknown>;
  traceId: string;
  toolCallsTotal: number;
  knownFacts: string[];
}

export async function runOrchestrator(
  userMessage: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const traceId = config.traceId ?? randomUUID();
  const client = new QwenCompatibleClient(config.clientConfig);

  const knownFacts: string[] = config.sessionContext?.knownFacts ?? [];
  let savedDraft: Record<string, unknown> | undefined;

  const toolRegistry = buildToolRegistry({
    employeeRepo: config.employeeRepo,
    knownFacts: {
      get: () => [...knownFacts],
      update: (facts: string[]) => {
        for (const f of facts) {
          if (!knownFacts.includes(f)) knownFacts.push(f);
        }
      },
    },
    onDraftSaved: (draft: Record<string, unknown>) => {
      savedDraft = draft;
    },
  });

  const tools = Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {};
  for (const [name, entry] of Object.entries(toolRegistry)) {
    handlers[name] = entry.handler;
  }

  // Build messages with conversation history
  const sysPrompt = buildQwenPlannerSystemPrompt();
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
  if (config.sessionContext?.latestDraft) {
    memoryParts.push(`latestDraftSummary: ${safeJson(summarizeDraftForPrompt(config.sessionContext.latestDraft))}`);
  }
  if (config.sessionContext?.latestAssignment) {
    memoryParts.push(
      `latestAssignmentSummary: ${safeJson(summarizeAssignmentForPrompt(config.sessionContext.latestAssignment))}`,
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
  for (const h of history.slice(-5)) {
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
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ReAct loop exceeded max iterations")) {
      logStructured({
        event: "orchestrator_max_turns_exceeded",
        traceId,
        maxToolIterations,
        reason: msg,
        hasPartialDraft: savedDraft !== undefined,
      });
      return {
        messages: [
          buildOrchestratorIterationLimitMessage(userMessage, {
            hasPartialDraft: savedDraft !== undefined,
          }),
        ],
        draft: savedDraft,
        assignment: undefined,
        traceId,
        toolCallsTotal: maxToolIterations,
        knownFacts: [...knownFacts],
      };
    }
    throw err;
  }

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;
  const timing = response.timing;

  const msg = String(payload?.message ?? "").trim();
  const assignment = isPlainObject(payload?.assignment) ? payload?.assignment as Record<string, unknown> : undefined;

  const messages: string[] = msg ? [msg] : [];
  let draft: Record<string, unknown> | undefined = savedDraft ?? (payload?.draft as Record<string, unknown> | undefined);

  logStructured({
    event: "orchestrator_done",
    traceId,
    toolCallsTotal,
    llmMsTotal: timing?.llmMsTotal ?? null,
    toolsMsTotal: timing?.toolsMsTotal ?? null,
    parseMsTotal: timing?.parseMsTotal ?? null,
    orchestratorLoopMs: timing?.totalMs ?? null,
    loopIterations: timing?.iterations.length ?? null,
    hasDraft: draft !== undefined,
    hasAssignment: assignment !== undefined,
    messageChars: msg.length,
    messagePreview: msg.slice(0, 200),
  });

  return { messages, draft, assignment, traceId, toolCallsTotal, knownFacts: [...knownFacts] };
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
    taskCount: tasks.length,
    taskTitles,
    domain: (draft as { classification?: { domain?: unknown } }).classification?.domain ?? null,
    subtype: (draft as { classification?: { subtype?: unknown } }).classification?.subtype ?? null,
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
    assignmentCount: assignments.length,
    taskIds: assignments
      .map((a) => String(a?.taskId ?? "").trim())
      .filter((id) => id.length > 0)
      .slice(0, 8),
  };
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
