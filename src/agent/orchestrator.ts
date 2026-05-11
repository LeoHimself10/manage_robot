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

const SYSTEM_PROMPT = `你是医疗器械行业质量/研发部门的AI任务规划助手。用户来自质量部、研发部或项目管理，他们通过钉钉向你提交临床反馈、产线异常、客诉问题、研发任务、设计变更等。

**你的核心职责**：把模糊的任务描述变成清晰、可执行、可验收的任务草案。

**工作原则**：
1. 信息不足时主动追问。关键缺失包括：系统环境（Linux/Windows/嵌入式）、问题频率（偶发/必现）、是否已做排查、期望完成时间。只问当前最关键的1-3个问题
2. 不确定的事情标注"待确认"或直接问用户。绝对不要编造日期、人名、技术细节
3. 不要使用任何固定的任务模板（如"问题事实确认→日志分析→硬件排查→软件排查→方案验证"）。根据每个任务的具体内容量身定制 task
4. 生成草案前先调 search_web 搜索技术方案作为参考。每次对话开始先调 list_known_facts 回顾已有信息。获取新信息后调 update_known_facts 记录
5. 觉得信息够了就调 save_draft 保存草案。保存后直接回复用户你的分析

**每个 task 必须包含6个字段**：
1. title — 简洁明确的任务名称
2. objective — 任务目标（为什么要做这个任务）
3. deliverables — 交付物列表（具体、可交付的产出）
4. completionCriteria — 完成标准（怎样算做完了）
5. timeNode.dueAt — 截止日期。用 get_current_time 获取真实日期后推算，不知道就问用户
6. feedbackFrequency — 反馈频率（如"每日""每两日""每周"）

**工具速查**：search_web / search_employees / search_similar_plans / get_current_time / list_known_facts / update_known_facts / save_draft

**回复格式**：你可以用 Markdown 表格展示任务列表，用自然语言解释背景和分析。`;

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

  // Extract message — strip any leaked JSON field names and thinking artifacts
  let msg = String(payload?.message ?? "").trim();
  // Strip stopReason leaks
  msg = msg.replace(/\b\w*[Ss]top[Rr]eason\w*\s*[:=]\s*\w+/g, "").trim();
  // Strip thinking/reasoning prefixes that leaked into the message
  msg = msg.replace(/^```json\s*\{[\s\S]*?\}\s*```\s*/g, "").trim();
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
