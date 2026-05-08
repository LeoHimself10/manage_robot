/**
 * 钉钉 NEEDS_MORE_INFO：仅推送模型给出的追问条目，不在此自动拼接固定引导句。
 */
export function formatNeedsMoreInfoDingTalkMarkdown(questions: string[]): string {
  return questions.map((q) => `- ${q}`).join("\n");
}
