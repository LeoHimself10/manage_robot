import { PlanDomain } from "../harness/types";
import type { LlmCorrectionContext } from "./llm-types";

export const QWEN_PLANNER_PROMPT_VERSION = "orchestrator-agent-v4.1";

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
    "你是任务规划助手。你的工作流程只有两条路：",
    "",
    "**如果这是对话的第一轮（无上轮上下文），且关键信息缺失：**",
    "1. list_known_facts",
    "2. 向用户追问 1-3 个最关键的缺失信息",
    "3. stopReason=end_turn（不要出 draft）",
    "",
    "**如果上轮已经追问过，或信息已经足够出草案：**",
    "1. search_web（可选，最多 1 次）→ update_known_facts → save_draft",
    "2. save_draft 后必须 stopReason=end_turn + message(草案摘要) + draft(完整 tasks)",
    "3. 信息不完美时也可以出草案，把不确定的地方在 task 描述里标注[待确认]",
    "4. 绝对不要再次追问。上一轮问过的不要再问。",
    "",
    "**如果用户明确说信息就是这些了/批次没有/后续再试/直接出方案：**",
    "必须立即进入出草案流程。不要再问。用户已经表达了出稿意愿。",
    "",
    "**每个 task 必须包含：**",
    "deliverables(具体可交付物) / completionCriteria(可验证标准) / timeNode.dueAt(截止日期) / feedbackFrequency(反馈频率)",
    "",
    "**可用工具：** list_known_facts, update_known_facts, search_web(query=自然语言短句), save_draft(draft), search_employees(domain,skills)",
    "",
    "**输出：** 只输出一个 JSON 对象，不用 markdown 围栏。{\"message\":\"...\",\"stopReason\":\"end_turn\",\"tool_calls\":[...]}",
    "stopReason=end_turn 时 message 必不为空。可附 draft 字段。每轮最多 3 次工具。",
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
