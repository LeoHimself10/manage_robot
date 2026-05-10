import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig, ToolDefinition, ToolHandler } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
import { buildToolRegistry } from "./tools/registry";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "./demo/llm-schema";
import { redactCommonPii } from "../infra/content-filter";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";
import { SAVE_DRAFT_TOOL } from "./tools/save-draft";

const MAX_TOOL_ITERATIONS = 8;

export interface OrchestratorConfig {
  clientConfig: QwenCompatibleClientConfig;
  employeeRepo: { list(): EmployeeProfileRecord[] };
  sessionContext?: { knownFacts?: string[]; isFollowUp?: boolean };
  traceId?: string;
}

export interface OrchestratorResult {
  messages: string[];
  draft?: Record<string, unknown>;
  traceId: string;
  turns: number;
  toolCallsTotal: number;
}

const PROMPT_PHASE1 = [
  "你是任务规划助手。这是本轮对话的第一条消息，你的任务是了解情况。",
  "",
  "**你必须做的事：**",
  "1. 先调 list_known_facts 查看已知信息",
  "2. 如果关键信息缺失（任务背景/环境/频率/截止时间等），向用户追问 1-3 个最关键的问题",
  "3. stopReason=end_turn（本轮不可出草案，不可调 save_draft）",
  "",
  "**追问原则：** 只问对拆解任务最关键的信息。不要问已经知道的事。",
  "",
  "**输出：** {\"message\":\"你的追问\",\"stopReason\":\"end_turn\",\"tool_calls\":[...]}",
  "只输出 JSON，不用 markdown 围栏。每轮最多 3 次工具。",
].join("\n");

const PROMPT_PHASE2 = [
  "你是任务规划助手。用户已经提供了信息（可能在上轮对话中），现在必须出草案。",
  "",
  "**你必须做的事：**",
  "1. get_current_time（先调，所有截止日期基于当前真实日期）",
  "2. list_known_facts → search_web（可选，1 次）→ update_known_facts → save_draft",
  "3. save_draft 后 stopReason=end_turn + message(草案摘要) + draft",
  "",
  "**绝对禁止追问！** 信息不全的标注 [待确认]，不能成为不出草案的理由。",
  "",
  "**每个 task 必须含：** deliverables/completionCriteria/timeNode.dueAt/feedbackFrequency",
  "",
  "**输出：** {\"message\":\"草案摘要\",\"stopReason\":\"end_turn\",\"draft\":{tasks,classification,gateSelfCheck},\"tool_calls\":[...]}",
  "只输出 JSON，不用 markdown 围栏。每轮最多 4 次工具。",
].join("\n");

function filterTools(
  registry: Record<string, { definition: ToolDefinition; handler: ToolHandler }>,
  phase: "ask" | "draft"
): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const tools: ToolDefinition[] = [];
  const handlers: Record<string, ToolHandler> = {};
  for (const [name, entry] of Object.entries(registry)) {
    // Phase 1 (ask): exclude save_draft
    if (phase === "ask" && name === "save_draft") continue;
    tools.push(entry.definition);
    handlers[name] = entry.handler;
  }
  return { tools, handlers };
}

export async function runOrchestrator(
  userMessage: string,
  config: OrchestratorConfig
): Promise<OrchestratorResult> {
  const traceId = config.traceId ?? randomUUID();
  const client = new QwenCompatibleClient(config.clientConfig);

  const knownFacts: string[] = config.sessionContext?.knownFacts ?? [];
  const isFollowUp = config.sessionContext?.isFollowUp ?? false;

  const fullRegistry = buildToolRegistry({
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

  // 代码强制两阶段：第一轮只能追问，后续轮必须出草案
  const phase: "ask" | "draft" = isFollowUp ? "draft" : "ask";
  const { tools, handlers } = filterTools(fullRegistry, phase);
  const sysPrompt = phase === "ask" ? PROMPT_PHASE1 : PROMPT_PHASE2;

  const response = await client.callWithTools({
    traceId,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userMessage },
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

  // 兜底：原始文本
  if (!msg.trim() && response.rawContent.trim()) {
    const trimmed = response.rawContent.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      msg = redactCommonPii(trimmed);
    }
  }

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
    phase,
    toolCallsTotal,
    hasDraft: draft !== undefined,
    messageChars: msg.length,
    messagePreview: msg.slice(0, 200),
  });

  return { messages, draft, traceId, turns: 1, toolCallsTotal };
}
