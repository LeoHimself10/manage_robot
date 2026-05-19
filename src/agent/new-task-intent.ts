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

export function getCurrentScopeLabel(session: {
  currentTaskScopeId?: string;
  taskScopes?: Record<string, { scopeLabel?: string }>;
}): string | undefined {
  const scopeId = session.currentTaskScopeId;
  if (!scopeId || !session.taskScopes?.[scopeId]) return undefined;
  return String(session.taskScopes[scopeId]?.scopeLabel ?? "").trim() || undefined;
}

/**
 * 用户描述的新事项与当前 scopeLabel 明显不是同一条规划（如「运输故障」→「产线报错1210」）。
 * 用于在 ReAct 之前预清 candidatePool / 草案，避免旧名单粘连。
 */
export function isLikelyTopicShiftFromScope(
  message: string,
  currentScopeLabel?: string,
): boolean {
  const msg = message.replace(/\s+/g, " ").trim();
  const scope = String(currentScopeLabel ?? "").replace(/\s+/g, " ").trim();
  if (!msg || !scope || msg.length < 16) return false;
  if (isExplicitNewTaskRequest(msg)) return false;

  const msgCore = msg.slice(0, 80);
  if (msgCore.includes(scope) || scope.includes(msgCore.slice(0, Math.min(10, msgCore.length)))) {
    return false;
  }

  const octInBoth = /OCT|oct/i.test(msg) && /OCT|oct/i.test(scope);
  if (octInBoth) {
    const hasTransport = (s: string) => /运输|周转|包装|抗震|医疗箱/.test(s);
    const hasLineFault = (s: string) => /报错|1210|通信|老化|产线|蓝屏|黑屏/.test(s);
    const scopeTransport = hasTransport(scope);
    const msgTransport = hasTransport(msg);
    const scopeFault = hasLineFault(scope);
    const msgFault = hasLineFault(msg);
    if (scopeTransport && msgFault && !msgTransport) return true;
    if (scopeFault && msgTransport && !msgFault) return true;
  }

  if (msg.length >= 40 && /任务|问题|排查|故障|整改|专项/.test(msg)) {
    const scopeKey = scope.slice(0, Math.min(12, scope.length));
    if (scopeKey.length >= 4 && !msg.includes(scopeKey.slice(0, 4))) {
      return true;
    }
  }
  return false;
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
