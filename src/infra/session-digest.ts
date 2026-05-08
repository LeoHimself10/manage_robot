import type { TaskPlanningDemoResult } from "../agent/demo/pipeline";

const DEFAULT_MAX_CHARS = 2000;

/** Markdown-free digest for planner user prompt continuity (bounded length). */
export function summarizePriorDemoForPrompt(
  result: TaskPlanningDemoResult,
  maxChars = DEFAULT_MAX_CHARS
): string | undefined {
  const lines: string[] = [];

  if (result.status === "NEEDS_MORE_INFO") {
    lines.push("上一轮系统状态：NEEDS_MORE_INFO。");
    if (result.questions.length > 0) {
      lines.push("上一轮追问：\n" + result.questions.map((q) => q.trim()).filter(Boolean).join("\n"));
    }
  } else if (result.status === "GENERATION_FAILED") {
    lines.push("上一轮生成失败。", `原因摘录：${result.reason.slice(0, 280)}`);
  } else if (result.status === "DRAFT_READY") {
    lines.push("上一轮已成功生成拆解草案。", `领域=${result.classification.domain}，派发门禁=${result.gate.passed ? "通过" : "未通过"}。`);
    if (result.questions.length > 0) {
      lines.push("仍需关注的问题：" + result.questions.slice(0, 10).join("； "));
    }
  }

  if (lines.length === 0) return undefined;
  const text = ["## 上轮上下文（请在本次输出中接续已给定事实，若无矛盾勿重复发问）", ...lines].join(
    "\n"
  );
  return text.length > maxChars ? text.slice(0, maxChars) + "\n...(截断)" : text;
}
