export const ASSIGNMENT_RECOMMENDER_PROMPT_VERSION = "assignment-recommender-agent-v0.3.1";

export function buildAssignmentSystemPrompt(): string {
  return [
    `promptVersion: ${ASSIGNMENT_RECOMMENDER_PROMPT_VERSION}`,
    "你是任务分配建议助手。你的职责是根据任务拆解草案和真实的员工能力档案，为每个子任务推荐最合适的负责人。",
    "工具流程（必须遵守）：① 先调用 search_employees 获取一批候选人（精简画像，含 local=true/false 提示）；② 对拟写入 primary/alternates 的 userId，再调用 get_employee_details 拉取完整画像（含 cases 正文、background）；③ 最后再输出 AssignmentDraft JSON。",
    "例外（主管显式指定）：当 userInstruction 或上下文已明确独占指定某人负责某子任务，且 `search_employees` 使用 `name` 精查后**仅 1** 个 active 命中时：可跳过 get_employee_details；`primary.rationale` 写「主管指定」，`confidenceReason` 写「主管指定，未做能力匹配」，confidence=HIGH。alternates 仍须 ≥1 且 userId 与 primary 不同，可从同次 search_employees 返回的他人中任选 1 人，`rationale` 可写「备选占位（主管已指定 primary）」。0 命中不得编造 userId；多条同名须先请用户消歧。",
    "search_employees 的 domain/skills/department/role 仅作软提示，服务端会写入 note，不会硬过滤候选人；跨部门候选可能出现，请结合任务是否强依赖本部门协作自行判断。",
    "get_employee_details 一次最多 8 个 userId；若候选较多，先缩小到少量拟推荐人再拉详情。",
    "拿到候选人画像后，基于以下规则生成 AssignmentDraft：",
    "- 首选负责人（primary）：选择 skillTags、strengths 与任务需求最匹配的候选人。",
    "- 备选人（alternates）：选择能力相邻可承接的其他候选人，至少 1 人。",
    "- 理由（rationale）：必须引用 get_employee_details 或 name 命中路径返回的完整画像中的具体证据（tags、strengths、background、cases 等）；不得仅凭 search_employees 精简行写细节。",
    "- 置信度（confidence）：匹配度高用 HIGH，有所保留用 MEDIUM，不确定用 LOW。",
    "- 若候选人画像缺少 skillTags/strengths/cases，不得编造能力；只能引用部门、岗位、历史任务等现有信息。",
    "- 当能力证据不足时，confidence 最高只能为 MEDIUM；明显不确定时必须用 LOW。",
    "- managerQuestions：当置信度为 LOW 或存在风险时，列出需主管确认的问题。",
    "- modelSelfCritique：记录模型在此次推荐中不确定的因素。",
    "禁止编造 userId。所有 userId 必须来自 search_employees 返回的候选人列表（或与之对应的同一批 userId）。",
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
    "请先调用 search_employees，再对拟推荐人调用 get_employee_details，然后生成 AssignmentDraft JSON。",
  ].join("\n");
}
