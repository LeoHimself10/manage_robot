export function normalizeRelationTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s，,;；。！？!?、·\-—_]/g, "")
    .trim();
}

export function titleContains(needle: string, haystack: string): boolean {
  const n = normalizeRelationTitle(needle);
  const h = normalizeRelationTitle(haystack);
  if (!n || !h) return false;
  return h.includes(n) || n.includes(h);
}

export function levenshteinSimilarity(a: string, b: string): number {
  const s = normalizeRelationTitle(a);
  const t = normalizeRelationTitle(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const m = s.length;
  const n = t.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  const dist = dp[m][n];
  return 1 - dist / Math.max(m, n);
}

export interface RelationRuleHit {
  relationKind: "duplicate" | "contained" | "superset" | "similar" | "none";
  existingTaskNo?: string;
  existingSubtaskId?: string;
  existingSubtaskTitle?: string;
  reason: string;
}

export function rulePrefilterRelation(input: {
  itemTitle: string;
  itemExcerpt: string;
  subtasks: Array<{
    taskNo: string;
    taskTitle: string;
    subtaskId: string;
    title: string;
  }>;
}): RelationRuleHit {
  const probe = `${input.itemTitle} ${input.itemExcerpt}`.trim();
  let bestSimilar: RelationRuleHit | undefined;

  for (const st of input.subtasks) {
    const titleSim = levenshteinSimilarity(input.itemTitle, st.title);
    const sim = Math.max(titleSim, levenshteinSimilarity(probe, st.title));
    if (sim >= 0.92) {
      return {
        relationKind: "duplicate",
        existingTaskNo: st.taskNo,
        existingSubtaskId: st.subtaskId,
        existingSubtaskTitle: st.title,
        reason: `与子任务「${st.title}」高度相似`,
      };
    }
    if (
      titleContains(input.itemTitle, st.title) &&
      normalizeRelationTitle(input.itemTitle).length < normalizeRelationTitle(st.title).length
    ) {
      return {
        relationKind: "contained",
        existingTaskNo: st.taskNo,
        existingSubtaskId: st.subtaskId,
        existingSubtaskTitle: st.title,
        reason: `待办内容已被子任务「${st.title}」覆盖`,
      };
    }
    if (
      titleContains(st.title, input.itemTitle) &&
      normalizeRelationTitle(st.title).length < normalizeRelationTitle(input.itemTitle).length
    ) {
      return {
        relationKind: "superset",
        existingTaskNo: st.taskNo,
        existingSubtaskId: st.subtaskId,
        existingSubtaskTitle: st.title,
        reason: `待办范围大于已有子任务「${st.title}」`,
      };
    }
    if (sim >= 0.72) {
      bestSimilar = {
        relationKind: "similar",
        existingTaskNo: st.taskNo,
        existingSubtaskId: st.subtaskId,
        existingSubtaskTitle: st.title,
        reason: `与子任务「${st.title}」语义相近`,
      };
    }
  }

  return bestSimilar ?? { relationKind: "none", reason: "未发现明显重复" };
}

export function defaultSelectedForRelation(kind: RelationRuleHit["relationKind"]): boolean {
  return kind !== "duplicate" && kind !== "contained";
}
