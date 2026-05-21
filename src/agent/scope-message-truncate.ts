const SCOPE_SWITCH_TOOLS = new Set(["start_new_task", "switch_back_task"]);

export function isScopeSwitchToolOk(toolName: string, result: unknown): boolean {
  if (!SCOPE_SWITCH_TOOLS.has(toolName)) return false;
  const row = result as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return false;
  return row.ok === true || String(row.ok ?? "") === "true";
}

export function readScopeSwitchPlanId(result: unknown): string | undefined {
  const row = result as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return undefined;
  const planId = String(row.toPlanId ?? "").trim();
  return planId || undefined;
}

/**
 * After start_new_task / switch_back_task ok: drop persisted conversationHistory
 * copies still present in the ReAct message array (system + memory + current user + tool tail kept).
 */
export function truncateMessagesAfterScopeSwitch(
  messages: Array<Record<string, unknown>>,
): void {
  if (messages.length === 0) return;

  let prefixEnd = 1;
  if (
    messages.length > 1
    && messages[1]?.role === "assistant"
    && String(messages[1]?.content ?? "").includes("[memory_context]")
  ) {
    prefixEnd = 2;
  }

  let toolChainStart = messages.length;
  for (let i = prefixEnd; i < messages.length; i += 1) {
    const row = messages[i];
    if (row?.role === "assistant" && Array.isArray(row.tool_calls) && row.tool_calls.length > 0) {
      toolChainStart = i;
      break;
    }
  }

  let userTurnIdx = -1;
  for (let i = toolChainStart - 1; i >= prefixEnd; i -= 1) {
    if (messages[i]?.role === "user") {
      userTurnIdx = i;
      break;
    }
  }
  if (userTurnIdx < 0 || userTurnIdx <= prefixEnd) return;

  const head = messages.slice(0, prefixEnd);
  const tail = messages.slice(userTurnIdx);
  messages.splice(0, messages.length, ...head, ...tail);
}

/** Strip stale draft/assignment/candidate hints from memory_context after scope rotation. */
export function refreshMemoryContextAfterScopeSwitch(
  messages: Array<Record<string, unknown>>,
  planId: string,
): void {
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    const raw = String(m.content ?? "");
    if (!raw.includes("[memory_context]")) continue;

    const kept: string[] = [`planId: ${planId}`];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("[memory_context]")) continue;
      if (/^planId:/.test(trimmed)) continue;
      if (/^latestDraft\b|^latestAssignmentSummary|^candidatePool|^pendingRoster|^publishStaging|^draftReviseDiscipline/.test(trimmed)) {
        continue;
      }
      kept.push(trimmed);
    }
    m.content = `[memory_context]\n${kept.join("\n")}`;
    return;
  }
}

export function applyScopeSwitchToRuntimeMessages(
  messages: Array<Record<string, unknown>>,
  toolResults: Array<{ toolName: string; result: unknown }>,
): boolean {
  let rotated = false;
  for (const { toolName, result } of toolResults) {
    if (!isScopeSwitchToolOk(toolName, result)) continue;
    rotated = true;
    truncateMessagesAfterScopeSwitch(messages);
    const planId = readScopeSwitchPlanId(result);
    if (planId) refreshMemoryContextAfterScopeSwitch(messages, planId);
  }
  return rotated;
}
