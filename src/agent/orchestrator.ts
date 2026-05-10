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
  "你是任务规划助手。你可以自由使用以下工具：",
  "- list_known_facts — 查看已记录的事实",
  "- update_known_facts(facts) — 记录新事实",
  "- search_web(query) — 搜索技术方案，query 用自然语言短句",
  "- search_similar_plans(query) — 搜索历史类似任务",
  "- get_current_time — 获取当前日期时间",
  "- save_draft(draft) — 保存任务草案（触发门禁校验）",
  "- search_employees(domain, skills) — 搜索候选人",
  "",
  "硬边界：",
  "- 出任务草案时每个 task 必须含 deliverables/completionCriteria/timeNode.dueAt/feedbackFrequency",
  "- 推荐人选必须来自 search_employees 返回的候选人",
  "",
  "除此之外你自由决定：何时追问、何时搜索、何时出稿、何时指派。",
  "你觉得信息够了就调 save_draft 出草案，觉得不够就追问。",
  "调用 save_draft 后必须输出 stopReason=end_turn + message + draft。",
  "",
  "输出 JSON：{\"message\":\"...\",\"stopReason\":\"end_turn\",\"tool_calls\":[...],\"draft\":{...}}",
  "每轮最多 4 次工具调用。不用 markdown 围栏。",
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
