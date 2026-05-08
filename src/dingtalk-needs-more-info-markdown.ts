/**
 * 钉钉 NEEDS_MORE_INFO：仅推送模型给出的文案，不使用列表符号（避免首行出现项目符号）。
 */
export function formatNeedsMoreInfoDingTalkMarkdown(questions: string[]): string {
  return questions.map((q) => q.trim()).filter(Boolean).join("\n\n");
}
