export const ASSIGNMENT_RECOMMENDER_PROMPT_VERSION = "assignment-recommender-agent-v0.2.0";

export function buildAssignmentSystemPrompt(): string {
  return [
    `promptVersion: ${ASSIGNMENT_RECOMMENDER_PROMPT_VERSION}`,
    "你是任务分配建议助手。你的职责是根据任务拆解草案和真实的员工能力档案，为每个子任务推荐最合适的负责人。",
    "你必须先调用 search_employees 工具一次，拿到候选人压缩画像后再生成分配建议。",
    "调用 search_employees 时，domain 字段应与任务领域匹配，skills 字段基于任务需求填写最相关的技能标签。",
    "拿到候选人画像后，基于以下规则生成 AssignmentDraft：",
    "- 首选负责人（primary）：选择 skillTags、strengths 与任务需求最匹配的候选人。",
    "- 备选人（alternates）：选择能力相邻可承接的其他候选人，至少 1 人。",
    "- 理由（rationale）：引用候选人画像中的具体证据（tags、strengths、cases->outcome）。",
    "- 置信度（confidence）：匹配度高用 HIGH，有所保留用 MEDIUM，不确定用 LOW。",
    "- 若候选人画像缺少 skillTags/strengths/cases，不得编造能力；只能引用部门、岗位、历史任务等现有信息。",
    "- 当能力证据不足时，confidence 最高只能为 MEDIUM；明显不确定时必须用 LOW。",
    "- managerQuestions：当置信度为 LOW 或存在风险时，列出需主管确认的问题。",
    "- modelSelfCritique：记录模型在此次推荐中不确定的因素。",
    "禁止编造 userId。所有 userId 必须来自 search_employees 返回的候选人列表。",
    "仅输出 JSON，不要输出解释文字。",
  ].join("\n");
}

export interface AssignmentUserPromptInput {
  planId: string;
  traceId: string;
  tasks: Array<{
    id: string;
    title: string;
    objective: string;
    deliverables: string[];
    timeNode: { dueAt: string };
  }>;
  classificationSummary: string;
  userInstruction?: string;
  previousAssignment?: Record<string, unknown>;
  knownFacts?: string[];
}

export function buildAssignmentUserPrompt(input: AssignmentUserPromptInput): string {
  const knownFacts = input.knownFacts?.length
    ? input.knownFacts.map((f) => `- ${f}`).join("\n")
    : "- (无)";

  return [
    `planId: ${input.planId}`,
    `traceId: ${input.traceId}`,
    `任务领域摘要：${input.classificationSummary}`,
    `已知事实（knownFacts）：\n${knownFacts}`,
    input.userInstruction
      ? `用户本轮修改要求：${input.userInstruction}`
      : "用户本轮修改要求：（无，按当前草案推荐）",
    `上一版分配草案：${JSON.stringify(input.previousAssignment ?? { assignments: [] })}`,
    `子任务列表：`,
    ...input.tasks.map(
      (t) =>
        `- ${t.id} ${t.title}：${t.objective}，交付物=${t.deliverables.join("；")}，截止=${t.timeNode.dueAt}`,
    ),
    "",
    "请先调用 search_employees 获取候选人画像，然后生成 AssignmentDraft JSON。",
  ].join("\n");
}
