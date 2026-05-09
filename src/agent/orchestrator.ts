import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
import { buildQwenPlannerSystemPrompt, buildQwenPlannerUserPrompt } from "./demo/qwen-prompt";
import { buildToolRegistry } from "./tools/registry";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "./demo/llm-schema";
import { redactCommonPii } from "../infra/content-filter";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";

const MAX_TOOL_ITERATIONS = 8;

export interface OrchestratorConfig {
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: { list(): EmployeeProfileRecord[] };
  sessionContext?: { knownFacts?: string[] };
  traceId?: string;
}

export interface OrchestratorResult {
  messages: string[];
  draft?: Record<string, unknown>;
  traceId: string;
  turns: number;
  toolCallsTotal: number;
}

export async function runOrchestrator(
  userMessage: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const traceId = config.traceId ?? randomUUID();
  const client = new QwenCompatibleClient(config.clientConfig);

  const knownFacts: string[] = config.sessionContext?.knownFacts ?? [];

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
  });

  const tools = Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {};
  for (const [name, entry] of Object.entries(toolRegistry)) {
    handlers[name] = entry.handler;
  }

  const sysPrompt = buildQwenPlannerSystemPrompt();
  const userPrompt = buildQwenPlannerUserPrompt({ background: userMessage, traceId });

  // 单次 callWithTools — 模型自主决定调多少轮工具
  const response = await client.callWithTools({
    traceId,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt },
    ],
    tools,
    toolHandlers: handlers,
    maxIterations: MAX_TOOL_ITERATIONS,
  });

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;
  let msg = redactCommonPii(String(payload?.message ?? ""));

  // 兜底：有 draft 但 message 为空
  if (!msg.trim() && payload?.draft) {
    const taskCount = (payload.draft as Record<string, unknown>)?.tasks as unknown[] | undefined;
    msg = `已生成任务拆解草案（${taskCount?.length ?? 0} 个任务包）。`;
  }

  // 兜底：模型输出原始文本
  if (!msg.trim() && response.rawContent.trim()) {
    const trimmed = response.rawContent.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      msg = redactCommonPii(trimmed);
    }
  }

  // 兜底：最终的兜底——模型完全没给内容
  if (!msg.trim()) {
    msg = "已收到您的需求。请提供更多信息以便我更好地帮助您。";
  }

  const messages: string[] = msg.trim() ? [msg] : [];
  let draft: Record<string, unknown> | undefined;

  if (payload?.draft) {
    const coerced = coerceLlmPlanPayload(payload.draft);
    const needsMore = needsMoreInfoFromLlmPayload(coerced);
    const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMore });
    if (validation.valid) {
      draft = coerced as unknown as Record<string, unknown>;
    }
  }

  logStructured({
    event: "orchestrator_done",
    traceId,
    toolCallsTotal,
    hasDraft: draft !== undefined,
    messageChars: msg.length,
  });

  return { messages, draft, traceId, turns: 1, toolCallsTotal };
}
