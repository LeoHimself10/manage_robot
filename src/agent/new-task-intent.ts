/**
 * Conservative detector for user turns that explicitly start a separate task.
 * This is used before the ReAct loop so old per-plan roster/candidate context
 * is not shown to the model in the same turn where the user asks to switch.
 */
export function isExplicitNewTaskRequest(message: string): boolean {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return false;

  if (/(不是|并非|不用|不要|无需|别).{0,6}新任务/.test(text)) return false;

  return [
    /^(新任务|新的任务|另一个任务|下一个任务)([:：\s]|$)/,
    /(开启|开始|新开|另开|另起|切换到|切到|换成|换个|换一?个|重新开)(一条|一个|个|条)?(新的?)?任务/,
    /(这个|这条|本条|下面|接下来).{0,8}(作为|算作|当作|按).{0,4}新任务/,
  ].some((pattern) => pattern.test(text));
}

export function deriveNewTaskScopeLabel(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  const cleaned = normalized
    .replace(/^(请|麻烦|帮我)?(开启|开始|新开|另开|另起|切换到|切到|换成|换个|重新开)(一条|一个|个|条)?(新的?)?任务[:：\s]*/u, "")
    .replace(/^(新任务|新的任务|另一个任务|下一个任务)[:：\s]*/u, "")
    .trim();
  const label = cleaned || normalized || "新任务";
  return label.slice(0, 30);
}

export function hasPlanScopedContextToClear(session: {
  latestDraft?: unknown;
  latestAssignment?: unknown;
  knownFacts?: unknown[];
  conversationHistory?: unknown[];
  candidatePool?: unknown;
  pendingRosterText?: unknown;
  pendingRosterSource?: unknown;
}): boolean {
  return Boolean(
    session.latestDraft
      || session.latestAssignment
      || (Array.isArray(session.knownFacts) && session.knownFacts.length > 0)
      || (Array.isArray(session.conversationHistory) && session.conversationHistory.length > 0)
      || session.candidatePool
      || session.pendingRosterText
      || session.pendingRosterSource,
  );
}
