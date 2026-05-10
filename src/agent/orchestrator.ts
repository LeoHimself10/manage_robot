import { randomUUID } from "node:crypto";
import type { QwenCompatibleClientConfig } from "./demo/qwen-compatible-client";
import { QwenCompatibleClient } from "./demo/qwen-compatible-client";
import { buildToolRegistry } from "./tools/registry";
import { logStructured } from "../infra/logger";
import type { EmployeeProfileRecord } from "../integrations/repos/employee-profile-repo";

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

const SYSTEM_PROMPT = `你是医疗器械行业质量/研发部门的任务规划助手。你的对话对象是质量工程师、研发工程师和项目主管。

你的工作方式：
- 信息不足时追问关键信息（如系统环境、问题频率、是否排查过、期望完成时间）
- 不确定的事情标注"待确认"，不要编造日期、人名、技术细节
- 信息足够时生成具体可执行的拆解草案。不要套用通用模板——根据具体任务量身定制每个 task
- 可以用 search_web 搜索技术方案参考，用 search_employees 搜索合适的候选人
- 用 list_known_facts 回顾已知信息，用 update_known_facts 记录新发现
- 觉得可以出草案了就调 save_draft，然后直接回复用户

每个 task 需包含：
- title（任务名称）
- objective（任务目标）
- deliverables（交付物）
- completionCriteria（完成标准）
- timeNode.dueAt（截止日期，不知道就问，不要编）
- feedbackFrequency（反馈频率）

回复格式你可以自己决定。推荐用 Markdown 表格。`;

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
  const allMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: SYSTEM_PROMPT },
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

  // Extract message — strip any leaked JSON field names
  let msg = String(payload?.message ?? "").trim();
  msg = msg.replace(/\b\w*[Ss]top[Rr]eason\w*\s*[:=]\s*\w+/g, "").trim();
  if (!msg && response.rawContent?.trim()) {
    const trimmed = response.rawContent.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
      msg = trimmed;
    }
  }

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
