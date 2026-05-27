const SCOPE_SWITCH_TOOL_NAMES = new Set(["start_new_task", "switch_back_task"]);

export function assignmentMatchesPlan(
  assignment: unknown,
  planId: string,
): boolean {
  if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) {
    return false;
  }
  const assignmentPlanId = String((assignment as { planId?: string }).planId ?? "").trim();
  if (!assignmentPlanId) return true;
  const currentPlanId = String(planId ?? "").trim();
  if (!currentPlanId) return true;
  return assignmentPlanId === currentPlanId;
}

export function scopeSwitchedThisTurn(input: {
  preTurnPlanId: string;
  sessionPlanId: string;
  toolInvocationNames?: readonly string[];
}): boolean {
  const pre = String(input.preTurnPlanId ?? "").trim();
  const cur = String(input.sessionPlanId ?? "").trim();
  if (pre && cur && pre !== cur) return true;
  for (const name of input.toolInvocationNames ?? []) {
    if (SCOPE_SWITCH_TOOL_NAMES.has(name)) return true;
  }
  return false;
}

export function resolveTurnLatestAssignment(input: {
  assignStateLatest?: Record<string, unknown>;
  sessionLatest?: Record<string, unknown>;
  preTurnAssignment?: unknown;
  sessionPlanId: string;
  preTurnPlanId: string;
  toolInvocationNames?: readonly string[];
}): Record<string, unknown> | undefined {
  const scopeSwitched = scopeSwitchedThisTurn({
    preTurnPlanId: input.preTurnPlanId,
    sessionPlanId: input.sessionPlanId,
    toolInvocationNames: input.toolInvocationNames,
  });

  if (input.assignStateLatest !== undefined) {
    if (!assignmentMatchesPlan(input.assignStateLatest, input.sessionPlanId)) {
      return undefined;
    }
    return input.assignStateLatest;
  }

  const sessionLatest = input.sessionLatest;
  if (
    sessionLatest
    && assignmentMatchesPlan(sessionLatest, input.sessionPlanId)
  ) {
    return sessionLatest;
  }

  if (scopeSwitched) {
    return undefined;
  }

  const preTurn = input.preTurnAssignment as Record<string, unknown> | undefined;
  if (preTurn && assignmentMatchesPlan(preTurn, input.sessionPlanId)) {
    return preTurn;
  }

  return undefined;
}

export function resolveSessionAssignmentForTurn(input: {
  sessionLatest?: Record<string, unknown>;
  preTurnAssignment?: unknown;
  sessionPlanId: string;
  preTurnPlanId: string;
  toolInvocationNames?: readonly string[];
}): Record<string, unknown> | undefined {
  return resolveTurnLatestAssignment({
    sessionLatest: input.sessionLatest,
    preTurnAssignment: input.preTurnAssignment,
    sessionPlanId: input.sessionPlanId,
    preTurnPlanId: input.preTurnPlanId,
    toolInvocationNames: input.toolInvocationNames,
  });
}
