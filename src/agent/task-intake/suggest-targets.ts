import {
  callTaskIntakeLlm,
  extractJsonFromLlmContent,
  loadTaskIntakePolicy,
  type TaskIntakePolicy,
} from "./task-intake-llm";

export interface ExistingTaskStub {
  planId: string;
  title: string;
  taskNo: string;
}

export interface TargetSuggestion {
  itemId: string;
  /** Set when the subtask belongs to an existing task. Mutually exclusive with newGroupId. */
  targetPlanId?: string;
  targetTitle?: string;
  targetNo?: string;
  /** Set when the subtask should go into a newly-created parent task group. */
  newGroupId?: string;   // e.g. "ng_1"
  newGroupTitle?: string;
  newGroupDescription?: string;
  confidence: number;
  reason?: string;
}

const SUGGEST_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = [
  "你是任务归属规划助手。给定一批「新子任务」和一批「已有父任务」，为每条子任务决定最优归属方案：",
  "  A) 归属到某个已有父任务（targetPlanId）",
  "  B) 与其他新子任务合并到一个新建父任务组（newGroupId + newGroupTitle + newGroupDescription）",
  "  C) 不确定，留给用户手动分配（两者均为 null）",
  "",
  "规则：",
  "1. 已有父任务匹配：仅当子任务标题/目标与已有父任务标题语义明确重叠时才选 A，confidence ≥ 0.6。",
  "2. 新建分组：对于不归属已有任务的子任务，按语义相似性聚类，同类子任务分配相同 newGroupId（如 ng_1、ng_2…），并给出合适的父任务标题 newGroupTitle 与描述/背景 newGroupDescription（1-2 句，说明该组子任务的整体目标与来由）。同一 newGroupId 的条目 newGroupTitle/newGroupDescription 须一致。一个子任务只属于一个新建组。",
  "   **默认合并**：若无已有任务可匹配，优先将所有子任务归入同一个 newGroupId（ng_1），仅当子任务明显属于两个及以上不同业务主题时才拆成多个 newGroupId。**禁止**为每条子任务单独创建一个父任务组。",
  "   若输入已给出统一父任务标题/背景，则全部子任务必须使用同一 newGroupId，newGroupTitle 采用该父任务标题。",
  "3. 不确定：若既无法匹配已有任务、又无法确定新建组归属（confidence < 0.6），则 targetPlanId 和 newGroupId 均输出 null。",
  "4. confidence 表示对当前决策的把握程度（0~1）。",
  "5. reason 用一句简短中文说明依据（≤20字）。",
  "6. 每条子任务必须有且仅有一条结果，itemId 原样保留。",
  "7. targetPlanId 和 newGroupId 互斥：若 targetPlanId 非 null，则 newGroupId 必须为 null，反之亦然。",
  "",
  "输出严格 JSON 数组，不要任何解释或 markdown：",
  '[{"itemId":string,"targetPlanId":string|null,"newGroupId":string|null,"newGroupTitle":string|null,"newGroupDescription":string|null,"confidence":number,"reason":string}]',
].join("\n");

function buildUserMessage(input: {
  subtasks: Array<{ itemId: string; title: string; objective?: string }>;
  existingTasks: ExistingTaskStub[];
  parentTitle?: string;
  parentDescription?: string;
}): string {
  const parentTitle = String(input.parentTitle ?? "").trim();
  const parentDescription = String(input.parentDescription ?? "").trim();
  const taskLines = input.existingTasks.length
    ? input.existingTasks.map((t) => `- planId=${t.planId} taskNo=${t.taskNo} 标题：${t.title}`).join("\n")
    : "（无已有父任务，所有子任务须分配到新建组）";

  const subtaskLines = input.subtasks
    .map((s) => `- itemId=${s.itemId} 标题：${s.title}${s.objective ? ` 目标：${s.objective}` : ""}`)
    .join("\n");

  const parentLines = parentTitle
    ? [
        "本批清单的统一父任务（用户已指定，新建组应优先合并到此标题下）：",
        `- 标题：${parentTitle}`,
        parentDescription ? `- 描述/背景：${parentDescription}` : "",
      ].filter(Boolean)
    : [];

  return [
    ...parentLines,
    parentLines.length ? "" : null,
    "已有父任务列表：",
    taskLines,
    "",
    "新子任务列表（需判断归属）：",
    subtaskLines,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function coerceSuggestions(
  parsed: unknown,
  subtasks: Array<{ itemId: string }>,
  existingByPlanId: Map<string, ExistingTaskStub>,
): TargetSuggestion[] {
  if (!Array.isArray(parsed)) return subtasks.map((s) => ({ itemId: s.itemId, confidence: 0 }));

  // Collect newGroupTitle / newGroupDescription keyed by newGroupId from the raw array
  const newGroupTitleMap = new Map<string, string>();
  const newGroupDescriptionMap = new Map<string, string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const gid = String(r.newGroupId ?? "").trim();
    const gtitle = String(r.newGroupTitle ?? "").trim();
    const gdesc = String(r.newGroupDescription ?? "").trim().slice(0, 2000);
    if (gid && gtitle && !newGroupTitleMap.has(gid)) newGroupTitleMap.set(gid, gtitle);
    if (gid && gdesc && !newGroupDescriptionMap.has(gid)) newGroupDescriptionMap.set(gid, gdesc);
  }

  const byItemId = new Map<string, TargetSuggestion>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const itemId = String(r.itemId ?? "").trim();
    if (!itemId) continue;

    const confidence = Math.min(1, Math.max(0, Number(r.confidence ?? 0)));
    const reason = String(r.reason ?? "").slice(0, 40) || undefined;

    if (confidence < 0.6) {
      byItemId.set(itemId, { itemId, confidence, reason });
      continue;
    }

    const rawPlanId = String(r.targetPlanId ?? "").trim();
    const rawGroupId = String(r.newGroupId ?? "").trim();

    if (rawPlanId) {
      const stub = existingByPlanId.get(rawPlanId);
      if (stub) {
        byItemId.set(itemId, {
          itemId,
          targetPlanId: stub.planId,
          targetTitle: stub.title,
          targetNo: stub.taskNo,
          confidence,
          reason,
        });
        continue;
      }
    }

    if (rawGroupId) {
      byItemId.set(itemId, {
        itemId,
        newGroupId: rawGroupId,
        newGroupTitle: newGroupTitleMap.get(rawGroupId),
        newGroupDescription: newGroupDescriptionMap.get(rawGroupId),
        confidence,
        reason,
      });
      continue;
    }

    // Fell through — treat as unassigned
    byItemId.set(itemId, { itemId, confidence: 0, reason });
  }

  return subtasks.map((s) => byItemId.get(s.itemId) ?? { itemId: s.itemId, confidence: 0 });
}

const GENERIC_PARENT_TITLES = new Set(["新建任务", "未命名任务"]);

/** When the user already named one parent task, collapse flaky multi-group LLM output. */
export function stabilizeNewGroupSuggestions(input: {
  suggestions: TargetSuggestion[];
  subtasks: Array<{ itemId: string }>;
  parentTitle?: string;
  parentDescription?: string;
}): TargetSuggestion[] {
  const parentTitle = String(input.parentTitle ?? "").trim();
  const parentDescription = String(input.parentDescription ?? "").trim();
  if (!parentTitle || GENERIC_PARENT_TITLES.has(parentTitle)) return input.suggestions;

  const hasExistingMatch = input.suggestions.some(
    (s) => s.targetPlanId && (s.confidence ?? 0) >= 0.6,
  );
  if (hasExistingMatch) return input.suggestions;

  const unifiedId = "ng_1";
  const normalize = (s: TargetSuggestion): TargetSuggestion => {
    if (s.targetPlanId && (s.confidence ?? 0) >= 0.6) return s;
    return {
      ...s,
      newGroupId: unifiedId,
      newGroupTitle: parentTitle,
      newGroupDescription: parentDescription || s.newGroupDescription,
      confidence: Math.max(s.confidence ?? 0, 0.85),
      reason: s.reason || "同批清单",
    };
  };

  const distinctGroups = new Set(
    input.suggestions
      .filter((s) => s.newGroupId && (s.confidence ?? 0) >= 0.6)
      .map((s) => s.newGroupId),
  );
  if (distinctGroups.size <= 1) {
    return input.suggestions.map((s) => {
      if (!s.newGroupId || (s.confidence ?? 0) < 0.6) return s;
      return {
        ...s,
        newGroupTitle: s.newGroupTitle?.trim() || parentTitle,
        newGroupDescription: s.newGroupDescription?.trim() || parentDescription || s.newGroupDescription,
      };
    });
  }

  return input.suggestions.map(normalize);
}

export async function suggestTaskTargets(input: {
  subtasks: Array<{ itemId: string; title: string; objective?: string }>;
  existingTasks: ExistingTaskStub[];
  parentTitle?: string;
  parentDescription?: string;
  policy?: TaskIntakePolicy;
}): Promise<TargetSuggestion[]> {
  const noSuggestions = input.subtasks.map((s) => ({ itemId: s.itemId, confidence: 0 }));
  if (!input.subtasks.length) return noSuggestions;

  const policy = input.policy ?? loadTaskIntakePolicy();
  if (!policy.llmEnabled) return noSuggestions;

  const existingByPlanId = new Map<string, ExistingTaskStub>(
    input.existingTasks.map((t) => [t.planId, t]),
  );

  try {
    const raw = await callTaskIntakeLlm({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(input),
      policy: { ...policy, llmTimeoutMs: SUGGEST_TIMEOUT_MS, llmMaxTokens: 2000 },
      temperature: 0,
    });
    if (!raw) return noSuggestions;
    const parsed = extractJsonFromLlmContent(raw);
    const coerced = coerceSuggestions(parsed, input.subtasks, existingByPlanId);
    return stabilizeNewGroupSuggestions({
      suggestions: coerced,
      subtasks: input.subtasks,
      parentTitle: input.parentTitle,
      parentDescription: input.parentDescription,
    });
  } catch {
    return noSuggestions;
  }
}
