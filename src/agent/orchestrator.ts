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
    memoryParts.push(`latestDraft: ${safeJson(config.sessionContext.latestDraft)}`);
  }
  if (config.sessionContext?.latestAssignment) {
    memoryParts.push(
      `latestAssignment: ${safeJson(config.sessionContext.latestAssignment)}`,
    );
  }
  if (memoryParts.length > 0) {
    allMessages.push({
      role: "assistant",
      content: `[memory_context]\n${memoryParts.join("\n")}`,
    });
  }

  const history = config.sessionContext?.conversationHistory ?? [];
  for (const h of history.slice(-10)) {
    allMessages.push({ role: h.role, content: h.content });
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
      });
      return {
        messages: ["我先给你一个简版结论：当前问题较复杂，我还需要1-2条关键信息才能输出完整草案。请补充“是否已做过初步排查结果”和“期望完成时间”。"],
        draft: savedDraft,
        traceId,
        toolCallsTotal: maxToolIterations,
        knownFacts: [...knownFacts],
      };
    }
    throw err;
  }

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;

  const msg = String(payload?.message ?? "").trim();

  const messages: string[] = msg ? [msg] : [];
  let draft: Record<string, unknown> | undefined = savedDraft ?? (payload?.draft as Record<string, unknown> | undefined);

  logStructured({
    event: "orchestrator_done",
    traceId,
    toolCallsTotal,
    hasDraft: draft !== undefined,
    messageChars: msg.length,
    messagePreview: msg.slice(0, 200),
  });

  return { messages, draft, traceId, toolCallsTotal, knownFacts: [...knownFacts] };
}

function safeJson(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}
