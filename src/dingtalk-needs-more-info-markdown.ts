/**
 * 钉钉 NEEDS_MORE_INFO：仅推送模型给出的文案，不使用列表符号（避免首行出现项目符号）。
 */
export function formatNeedsMoreInfoDingTalkMarkdown(
  questions: string[],
  assistantMessage?: string
): string {
  const assistant = assistantMessage?.trim() ?? "";
  const lines = [
    assistant,
    ...questions.map((q) => q.trim()).filter((q) => q && q !== assistant),
  ].filter(Boolean);
  return lines.join("\n\n");
}
