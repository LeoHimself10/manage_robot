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
  sessionContext?: { knownFacts?: string[]; conversationHistory?: Array<{ role: string; content: string }> };
  traceId?: string;
}

export interface OrchestratorResult {
  messages: string[];
  draft?: Record<string, unknown>;
  traceId: string;
  toolCallsTotal: number;
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
  const history = config.sessionContext?.conversationHistory ?? [];
  for (const h of history.slice(-10)) {
    allMessages.push({ role: h.role, content: h.content });
  }
  allMessages.push({ role: "user", content: userMessage });

  const response = await client.callWithTools({
    traceId,
    messages: allMessages,
    tools,
    toolHandlers: handlers,
    maxIterations: MAX_TOOL_ITERATIONS,
  });

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

  return { messages, draft, traceId, toolCallsTotal };
}
