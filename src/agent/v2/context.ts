import { buildTaskIndexMap } from "../assignment/false-assign";
import {
  buildTurnActionHintLine,
  formatPublishStagingActionHint,
} from "../orchestrator-turn-hints";
import {
  isDraftStagedForPublish,
  shouldInjectPublishStagingMemoryHint,
} from "../publish-staging";
import { normalizeDraftTasksForSession } from "../draft-person-fields";
import type { PlanSession } from "../../infra/plan-session-store";

export interface V2SessionContextInput {
  planId?: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  pendingRoster?: { sourceLabel: string; chars: number };
  candidatePool?: {
    source: string;
    entries: Array<{ userId: string; displayName: string; fileNotes?: string }>;
    unresolvedCount?: number;
  };
  currentTimeIso?: string;
  compactedSummary?: string;
  userMessage?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  knownFacts?: string[];
  session?: PlanSession;
  sourceContext?: PlanSession["sourceContext"];
}

function safeJson(input: unknown): string {
  try {
    return JSON.stringify(input);
  } catch {
    return "{}";
  }
}

function serializeDraftForContext(draft: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeDraftTasksForSession(draft);
  const maxChars = Number(process.env.ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS ?? "12000");
  const cap = Number.isFinite(maxChars) && maxChars > 500 ? Math.floor(maxChars) : 32000;
  const full = JSON.stringify(normalized);
  if (full.length <= cap) return normalized;

  const tasks = Array.isArray((normalized as { tasks?: unknown[] }).tasks)
    ? ((normalized as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  const slimTasks = tasks.map((t) => ({
    id: String(t?.id ?? ""),
    title: String(t?.title ?? "").slice(0, 120),
    objective: String(t?.objective ?? "").slice(0, 200),
    timeNode: (t?.timeNode as Record<string, unknown> | undefined)?.dueAt
      ? { dueAt: String((t.timeNode as Record<string, unknown>).dueAt ?? "") }
      : undefined,
  }));
  return {
    _truncated: true,
    title: normalized.title,
    description: typeof normalized.description === "string"
      ? (normalized.description as string).slice(0, 500)
      : normalized.description,
    tasks: slimTasks,
  };
}

/** v2 花名册纪律（无 search 重定向）。 */
export function formatV2PendingRosterHint(roster: { sourceLabel: string; chars: number }): string {
  return (
    `pendingRosterAction: ${JSON.stringify(roster)} → ①read_uploaded_roster_text ` +
    "→ ②resolve_roster_names（一次批量全部姓名）" +
    "→ ③set_candidate_pool（entries[*].fileNotes 必填）→ bulk_assign_tasks 全覆盖。"
  );
}

/** Per-turn action hints injected into session context (require, not compensate). */
export function buildV2ActionHintLines(input: {
  session: PlanSession;
  userMessage: string;
}): string[] {
  const hints: string[] = [];
  const sessionContext = {
    conversationHistory: input.session.conversationHistory,
    latestDraft: input.session.latestDraft as Record<string, unknown> | undefined,
    memoryFacts: input.session.knownFacts,
    pendingRoster: input.session.pendingRosterText
      ? {
          sourceLabel: input.session.pendingRosterSource ?? "uploaded:roster",
          chars: input.session.pendingRosterText.length,
        }
      : undefined,
    candidatePool: input.session.candidatePool
      ? {
          source: input.session.candidatePool.source,
          entries: input.session.candidatePool.entries,
        }
      : undefined,
  };

  if (sessionContext.pendingRoster) {
    hints.push(formatV2PendingRosterHint(sessionContext.pendingRoster));
  }

  if (
    shouldInjectPublishStagingMemoryHint({
      userMessage: input.userMessage,
      latestDraft: input.session.latestDraft,
    })
  ) {
    hints.push(formatPublishStagingActionHint(isDraftStagedForPublish(input.session.latestDraft)));
  }

  const turnHint = buildTurnActionHintLine(sessionContext, input.userMessage);
  if (turnHint) hints.push(turnHint);

  return hints;
}

/** Fact + action-hint context block injected each turn. */
export function buildV2ContextBlock(input: V2SessionContextInput): string {
  const parts: string[] = [];
  if (input.compactedSummary?.trim()) {
    parts.push(`conversationSummary: ${input.compactedSummary.trim()}`);
  }
  if (input.planId) parts.push(`planId: ${input.planId}`);
  if (input.currentTimeIso) parts.push(`currentTime: ${input.currentTimeIso}`);
  if (input.sourceContext?.kind === "quality_event") {
    parts.push(
      `qualitySourceContext (只读来源事实；不得改写、不得在此选择具体人员): ${safeJson(input.sourceContext)}`,
    );
  }
  if (input.latestDraft) {
    const taskIndexMap = buildTaskIndexMap(input.latestDraft);
    if (taskIndexMap.length > 0) {
      parts.push(`taskIndexMap: ${safeJson(taskIndexMap)}`);
    }
    parts.push(
      `latestDraft: ${safeJson(serializeDraftForContext(input.latestDraft))}`,
    );
  }
  if (input.latestAssignment) {
    const assignments = Array.isArray(
      (input.latestAssignment as { assignments?: unknown[] }).assignments,
    )
      ? (input.latestAssignment as { assignments: Array<Record<string, unknown>> }).assignments
      : [];
    const taskIds = assignments
      .map((a) => String(a?.taskId ?? "").trim())
      .filter(Boolean)
      .slice(0, 12);
    if (taskIds.length > 0) {
      parts.push(`latestAssignmentTaskIds: ${safeJson(taskIds)}`);
    }
  }
  if (input.pendingRoster) {
    parts.push(`pendingRoster: ${safeJson(input.pendingRoster)}`);
  }
  if (input.candidatePool) {
    parts.push(`candidatePool: ${safeJson(input.candidatePool)}`);
  }

  if (input.session && input.userMessage?.trim()) {
    const actionHints = buildV2ActionHintLines({
      session: input.session,
      userMessage: input.userMessage,
    });
    if (actionHints.length > 0) {
      parts.push(`actionHints:\n${actionHints.join("\n")}`);
    }
  }

  return parts.length > 0 ? `[session_context]\n${parts.join("\n")}` : "";
}

export function buildV2SessionContextFromPlanSession(
  session: PlanSession,
  compactedSummary?: string,
  userMessage?: string,
): V2SessionContextInput {
  return {
    planId: session.planId,
    latestDraft: session.latestDraft as Record<string, unknown> | undefined,
    latestAssignment: session.latestAssignment as Record<string, unknown> | undefined,
    currentTimeIso: new Date().toISOString(),
    pendingRoster: session.pendingRosterText
      ? {
          sourceLabel: session.pendingRosterSource ?? "uploaded:roster",
          chars: session.pendingRosterText.length,
        }
      : undefined,
    candidatePool: session.candidatePool
      ? {
          source: session.candidatePool.source,
          entries: session.candidatePool.entries.map((e) => ({
            userId: e.userId,
            displayName: e.displayName,
            ...(e.fileNotes?.trim()
              ? { fileNotes: e.fileNotes.trim().slice(0, 200) }
              : {}),
          })),
          unresolvedCount: session.candidatePool.unresolved?.length,
        }
      : undefined,
    compactedSummary,
    userMessage,
    conversationHistory: session.conversationHistory,
    knownFacts: session.knownFacts,
    sourceContext: session.sourceContext,
  };
}
