import type { AssignmentDraft } from "../agent/assignment/types";

export function buildAssignmentProgressMarkdown(): string {
  return [
    "---",
    "### 分配建议正在生成",
    "模型正在为每个子任务推荐责任人，稍后将单独推送分配建议。",
  ].join("\n");
}

export function buildAssignmentFollowUpMarkdown(params: {
  baseUrl: string;
  token: string;
  draft: AssignmentDraft;
}): string {
  const lines: string[] = [
    "---",
    "### 分配建议（预览）",
    "以下为模型推荐，请在链接中确认或调整。",
    "",
    "| 子任务 | 推荐负责人 | 置信度 |",
    "| --- | --- | --- |",
  ];
  for (const a of params.draft.assignments) {
    lines.push(`| ${a.taskId} | ${a.primary.displayName} | ${a.confidence} |`);
  }
  lines.push(
    "",
    `[打开分配工作台确认](${params.baseUrl}/assignment/workbench?token=${encodeURIComponent(params.token)})`,
  );
  return lines.join("\n");
}
