import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
import { buildQwenPlannerSystemPrompt, buildQwenPlannerUserPrompt } from "./demo/qwen-prompt";
import { buildToolRegistry } from "./tools/registry";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "./demo/llm-schema";
import { redactCommonPii } from "../infra/content-filter";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";

const MAX_REACT_TURNS = 6;

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

  const messages: Array<{ role: string; content?: string; tool_calls?: unknown[]; tool_call_id?: string }> = [
    { role: "system", content: sysPrompt },
    { role: "user", content: userPrompt },
  ];

  const userVisibleMessages: string[] = [];
  let draft: Record<string, unknown> | undefined;
  let turns = 0;
  let toolCallsTotal = 0;

  while (turns < MAX_REACT_TURNS) {
    turns += 1;

    const response = await client.callWithTools({
      traceId,
      messages,
      tools,
      toolHandlers: handlers,
      maxIterations: 2,
    });

    toolCallsTotal += response.toolCallsExecuted;

    const payload = response.payload as Record<string, unknown> | undefined;
    const stopReason = (payload?.stopReason as string) || "end_turn";
    let msg = redactCommonPii(String(payload?.message ?? ""));

    // 兜底：有 draft 但 message 为空时自动生成说明文字
    if (!msg.trim() && stopReason === "end_turn" && payload?.draft) {
      const taskCount = (payload.draft as Record<string, unknown>)?.tasks as unknown[] | undefined;
      msg = `已生成任务拆解草案（${taskCount?.length ?? 0} 个任务包）。请审阅下方的任务详情。`;
    }

    // 兜底：thinking 模式下模型可能输出原始文本而非 JSON，rawContent 本身就是用户可见内容
    if (!msg.trim() && response.rawContent.trim() && stopReason === "end_turn") {
      // rawContent 可能是自然语言文本（reasoning_content 兜底的结果）
      const trimmed = response.rawContent.trim();
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        msg = redactCommonPii(trimmed);
      }
    }

    if (msg.trim()) userVisibleMessages.push(msg);

    messages.push({ role: "assistant", content: response.rawContent });

    if (stopReason === "end_turn") {
      if (payload?.draft) {
        const coerced = coerceLlmPlanPayload(payload.draft);
        const needsMore = needsMoreInfoFromLlmPayload(coerced);
        const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMore });
        if (validation.valid) {
          draft = coerced as unknown as Record<string, unknown>;
        }
      }

      logStructured({ event: "orchestrator_end_turn", traceId, turns, toolCallsTotal, hasDraft: draft !== undefined });
      return { messages: userVisibleMessages, draft, traceId, turns, toolCallsTotal };
    }
  }

  logStructured({ event: "orchestrator_max_turns_exceeded", traceId, turns, toolCallsTotal });
  return { messages: userVisibleMessages, draft, traceId, turns, toolCallsTotal };
}
