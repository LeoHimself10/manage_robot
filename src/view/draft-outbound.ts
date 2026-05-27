import { deepMergePreserveRichFields } from "../agent/draft-merge";
import { normalizeDraftTasksForSession } from "../agent/draft-person-fields";

/** Tools that mutate session.latestDraft in-place during orchestrator. */
export const DRAFT_MUTATING_TOOL_NAMES = new Set([
  "prepare_publish_task",
  "update_draft_task",
  "add_draft_subtask",
  "remove_draft_subtask",
  "save_draft",
]);

/** In-place structural edits: do not replace tasks[] from thin orchestrator JSON. */
export const DRAFT_STRUCT_MUTATE_TOOL_NAMES = new Set([
  "update_draft_task",
  "add_draft_subtask",
  "remove_draft_subtask",
]);

export interface ResolveDraftForOutboundInput {
  preTurnDraft: unknown;
  postTurnDraft: unknown;
  orchResultDraft?: Record<string, unknown>;
  toolInvocationNames: ReadonlyArray<string>;
}

export interface ResolveDraftForOutboundResult {
  draftTouchedThisTurn: boolean;
  /** Draft to attach tables/supplements in DingTalk outbound; undefined = message only. */
  draftForRender?: Record<string, unknown>;
  /** Draft to persist in session / snapshots (always reflects session after tools). */
  persistedDraft?: Record<string, unknown>;
}

export function isDraftTouchedThisTurn(input: {
  preTurnDraft: unknown;
  postTurnDraft: unknown;
  orchResultDraft?: Record<string, unknown>;
  toolInvocationNames: ReadonlyArray<string>;
}): boolean {
  if (input.orchResultDraft) return true;
  if (input.toolInvocationNames.some((n) => DRAFT_MUTATING_TOOL_NAMES.has(n))) return true;
  if (input.postTurnDraft != null && input.postTurnDraft !== input.preTurnDraft) return true;
  return false;
}

/**
 * Merge orchestrator draft into session. Partial revise uses deep merge;
 * full JSON DRAFT replaces tasks[] to avoid stale scope task pollution.
 */
export function mergeOrchestratorDraftIntoSession(
  preTurnDraft: Record<string, unknown> | undefined,
  orchResultDraft: Record<string, unknown>,
  toolInvocationNames: ReadonlyArray<string>,
): Record<string, unknown> {
  const isPartialRevise = toolInvocationNames.some((n) => DRAFT_STRUCT_MUTATE_TOOL_NAMES.has(n));
  if (isPartialRevise) {
    const orchScalars = { ...orchResultDraft };
    delete orchScalars.tasks;
    return normalizeDraftTasksForSession(
      deepMergePreserveRichFields(preTurnDraft, orchScalars) as Record<string, unknown>,
    );
  }
  const merged = deepMergePreserveRichFields(preTurnDraft, orchResultDraft) as Record<string, unknown>;
  if (Array.isArray(orchResultDraft.tasks)) {
    merged.tasks = orchResultDraft.tasks;
  }
  return normalizeDraftTasksForSession(merged);
}

/**
 * Decide whether to render task tables this turn and what draft to use for session persistence.
 */
export function resolveDraftForOutbound(
  input: ResolveDraftForOutboundInput,
): ResolveDraftForOutboundResult {
  const pre = input.preTurnDraft as Record<string, unknown> | undefined;
  const post = input.postTurnDraft as Record<string, unknown> | undefined;
  const touched = isDraftTouchedThisTurn(input);

  // When !touched, only persist post (may be undefined after start_new_task cleared session).
  // Never fall back to pre — that re-writes archived draft after scope rotation.
  let persistedDraft: Record<string, unknown> | undefined = post;
  if (input.orchResultDraft) {
    persistedDraft = mergeOrchestratorDraftIntoSession(
      pre,
      input.orchResultDraft,
      input.toolInvocationNames,
    );
  }

  if (!touched) {
    return {
      draftTouchedThisTurn: false,
      persistedDraft: persistedDraft
        ? normalizeDraftTasksForSession(persistedDraft)
        : undefined,
    };
  }

  let draftForRender: Record<string, unknown> | undefined;
  if (input.orchResultDraft) {
    draftForRender = mergeOrchestratorDraftIntoSession(
      pre,
      input.orchResultDraft,
      input.toolInvocationNames,
    );
  } else if (post) {
    draftForRender = post;
  }

  const normalizedPersisted = persistedDraft
    ? normalizeDraftTasksForSession(persistedDraft)
    : undefined;
  const normalizedRender = draftForRender
    ? normalizeDraftTasksForSession(draftForRender)
    : undefined;

  return {
    draftTouchedThisTurn: true,
    draftForRender: normalizedRender,
    persistedDraft: normalizedPersisted,
  };
}
