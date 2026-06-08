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
  confidence: number;
  reason?: string;
}

const SUGGEST_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = [
  "你是任务归属规划助手。给定一批「新子任务」和一批「已有父任务」，为每条子任务决定最优归属方案：",
  "  A) 归属到某个已有父任务（targetPlanId）",
  "  B) 与其他新子任务合并到一个新建父任务组（newGroupId + newGroupTitle）",
  "  C) 不确定，留给用户手动分配（两者均为 null）",
  "",
  "规则：",
  "1. 已有父任务匹配：仅当子任务标题/目标与已有父任务标题语义明确重叠时才选 A，confidence ≥ 0.6。",
  "2. 新建分组：对于不归属已有任务的子任务，按语义相似性聚类，同类子任务分配相同 newGroupId（如 ng_1、ng_2…）并给出合适的父任务标题 newGroupTitle。一个子任务只属于一个新建组。",
  "3. 不确定：若既无法匹配已有任务、又无法确定新建组归属（confidence < 0.6），则 targetPlanId 和 newGroupId 均输出 null。",
  "4. confidence 表示对当前决策的把握程度（0~1）。",
  "5. reason 用一句简短中文说明依据（≤20字）。",
  "6. 每条子任务必须有且仅有一条结果，itemId 原样保留。",
  "7. targetPlanId 和 newGroupId 互斥：若 targetPlanId 非 null，则 newGroupId 必须为 null，反之亦然。",
  "",
  "输出严格 JSON 数组，不要任何解释或 markdown：",
  '[{"itemId":string,"targetPlanId":string|null,"newGroupId":string|null,"newGroupTitle":string|null,"confidence":number,"reason":string}]',
].join("\n");

function buildUserMessage(input: {
  subtasks: Array<{ itemId: string; title: string; objective?: string }>;
  existingTasks: ExistingTaskStub[];
}): string {
  const taskLines = input.existingTasks.length
    ? input.existingTasks.map((t) => `- planId=${t.planId} taskNo=${t.taskNo} 标题：${t.title}`).join("\n")
    : "（无已有父任务，所有子任务须分配到新建组）";

  const subtaskLines = input.subtasks
    .map((s) => `- itemId=${s.itemId} 标题：${s.title}${s.objective ? ` 目标：${s.objective}` : ""}`)
    .join("\n");

  return [
    "已有父任务列表：",
    taskLines,
    "",
    "新子任务列表（需判断归属）：",
    subtaskLines,
  ].join("\n");
}

function coerceSuggestions(
  parsed: unknown,
  subtasks: Array<{ itemId: string }>,
  existingByPlanId: Map<string, ExistingTaskStub>,
): TargetSuggestion[] {
  if (!Array.isArray(parsed)) return subtasks.map((s) => ({ itemId: s.itemId, confidence: 0 }));

  // Collect all newGroupTitles keyed by newGroupId from the raw array
  const newGroupTitleMap = new Map<string, string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const gid = String(r.newGroupId ?? "").trim();
    const gtitle = String(r.newGroupTitle ?? "").trim();
    if (gid && gtitle && !newGroupTitleMap.has(gid)) {
      newGroupTitleMap.set(gid, gtitle);
    }
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

export async function suggestTaskTargets(input: {
  subtasks: Array<{ itemId: string; title: string; objective?: string }>;
  existingTasks: ExistingTaskStub[];
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
    });
    if (!raw) return noSuggestions;
    const parsed = extractJsonFromLlmContent(raw);
    return coerceSuggestions(parsed, input.subtasks, existingByPlanId);
  } catch {
    return noSuggestions;
  }
}
