import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
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
  toolCallsTotal: number;
}

const SYSTEM_PROMPT = [
  "你是任务规划助手。根据用户描述，自主决定：追问、搜索资料、生成草案、推荐人选。",
  "工具：list_known_facts / update_known_facts / search_web / search_similar_plans / get_current_time / save_draft / search_employees。",
  "save_draft 后必须 stopReason=end_turn。每个 task 含 deliverables/completionCriteria/timeNode.dueAt/feedbackFrequency。人选来自 search_employees。",
  "输出 JSON，不用 markdown 围栏。自由决策。",
].join("\n");

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
    onDraftSaved: (draft) => {
      savedDraft = draft;
    },
  });

  const tools = Object.values(toolRegistry).map((e) => e.definition);
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown> | unknown> = {};
  for (const [name, entry] of Object.entries(toolRegistry)) {
    handlers[name] = entry.handler;
  }

  const response = await client.callWithTools({
    traceId,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    tools,
    toolHandlers: handlers,
    maxIterations: MAX_TOOL_ITERATIONS,
  });

  const toolCallsTotal = response.toolCallsExecuted;
  const payload = response.payload as Record<string, unknown> | undefined;
  const msg = redactCommonPii(String(payload?.message ?? ""));

  const messages: string[] = msg.trim() ? [msg] : [];
  let draft: Record<string, unknown> | undefined;

  // 优先用 save_draft 工具回调存储的已验证 draft
  if (savedDraft) {
    draft = savedDraft;
  } else if (payload?.draft) {
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
    messagePreview: msg.slice(0, 200),
  });

  return { messages, draft, traceId, toolCallsTotal };
}
