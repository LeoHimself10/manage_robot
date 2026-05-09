import { PlanDomain } from "../harness/types";
import type { LlmCorrectionContext } from "./llm-types";

export const QWEN_PLANNER_PROMPT_VERSION = "orchestrator-agent-v4.0";

export interface QwenPlannerPromptRequest {
  background: string;
  domainHint?: PlanDomain;
  traceId?: string;
  correction?: LlmCorrectionContext;
  sessionDigest?: string;
}

export function buildQwenPlannerSystemPrompt(): string {
  return [
    `promptVersion: ${QWEN_PLANNER_PROMPT_VERSION}`,
    "你是任务规划助手，把用户任务变成可承接的草案。每轮只做一件事：",
    "",
    "**回合A：信息不足 → 追问**",
    "先调 list_known_facts。关键信息缺失时直接追问用户，只问1-3个最关键的。设置 stopReason=end_turn，message=追问。不调搜索或 save_draft。",
    "",
    "**回合B：信息充足 → 出草案**",
    "仅当能为每个task写出具体 deliverables（非空话）时进入。",
    "流程：search_web(最多1次) → update_known_facts → save_draft。",
    "save_draft 后必须立即输出 stopReason=end_turn + message(草案摘要) + draft(完整tasks)。",
    "用户补充信息后直接更新草案，不要重新追问。",
    "",
    "**硬边界**",
    "- 每个task必含 deliverables/completionCriteria/timeNode.dueAt/feedbackFrequency，全部非空",
    "- 不编造事实/时间/人选，不确定标注待确认",
    "- 每轮最多3次工具调用",
    "",
    "**可用工具**",
    "- list_known_facts() — 开始思考前先调，避免重复追问",
    "- update_known_facts(facts) — 记录新事实",
    "- search_web(query) — 搜索技术方案，query是自然语言短句",
    "- save_draft(draft) — 保存草案，调用后本轮必须结束(stopReason=end_turn)",
    "- search_employees(domain,skills) — 搜索候选人",
    "",
    "**输出格式**",
    "每轮一个JSON，不用markdown围栏：",
    '{"message":"回复","stopReason":"end_turn","tool_calls":[{"function":{"name":"...","arguments":{}}}]}',
    "stopReason=end_turn时message必不为空，可附draft",
  ].join("\n");
}

export function buildQwenPlannerUserPrompt(
  request: QwenPlannerPromptRequest
): string {
  const lines: string[] = [];
  if (request.traceId) lines.push(`traceId: ${request.traceId}`);
  if (request.sessionDigest?.trim()) lines.push("", request.sessionDigest.trim(), "");
  lines.push(`domainHint: ${request.domainHint ?? "UNSPECIFIED"}`);
  lines.push(request.background);
  if (request.correction) {
    lines.push(
      "",
      "你上一次的 JSON 输出未通过结构校验，请仅修正以下问题后重新输出：",
      ...request.correction.validationErrors.map((e) => `- ${e}`),
      "",
      "## 上一次的输出",
      "```json",
      request.correction.previousRawJson,
      "```",
      "请只修正上述结构问题，保持其他内容不变。"
    );
  }
  return lines.join("\n");
}
