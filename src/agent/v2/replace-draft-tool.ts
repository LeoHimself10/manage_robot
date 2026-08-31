import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { normalizeDraftTasksForSession } from "../draft-person-fields";
import { stabilizeDraftTaskIds } from "../draft-stabilize";
import { clearPublishStagingOnDraft } from "../draft-staging-clear";
import { restoreQualityTaskMappings } from "../quality-task-coverage";

const QUALITY_PLANNING_CONTEXT_KEYS = ["qualityTaskPackage", "qualityHandoff"] as const;

/**
 * A quality-event redraft may replace tasks, but it must not turn the side
 * conversation back into an ordinary task or sever the immutable handoff.
 * The model is never authoritative for these integration fields, so always
 * carry them from the previous draft and then restore exact deliverable-name
 * mappings where the redraft retained the required outcome name.
 */
function preserveQualityPlanningContext(
  draft: Record<string, unknown>,
  previousDraft: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!previousDraft) return draft;
  const next = { ...draft };
  let isQualityDraft = false;
  for (const key of QUALITY_PLANNING_CONTEXT_KEYS) {
    const value = previousDraft[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    next[key] = value;
    isQualityDraft = true;
  }
  return isQualityDraft ? restoreQualityTaskMappings(next) ?? next : next;
}

export const REPLACE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "replace_draft",
    description:
      "用完整草案替换 session.latestDraft（整表 REDRAFT / WBS 重拆）。tasks[] 全量替换；" +
      "须含 title、description、tasks[]（每项含 id/title/objective/deliverables/completionCriteria/timeNode.dueAt）。" +
      "禁止在 draft.tasks 内写 assigneeUserId。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "父任务标题" },
        description: { type: "string", description: "背景/目标摘要，≤500 字" },
        tasks: {
          type: "array",
          description: "全量子任务列表，替换现有 tasks[]",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              objective: { type: "string" },
              deliverables: { type: "array", items: { type: "string" } },
              completionCriteria: { type: "array", items: { type: "string" } },
              timeNode: {
                type: "object",
                properties: { dueAt: { type: "string" } },
              },
              dependencyTaskIds: { type: "array", items: { type: "string" } },
              actions: { type: "array", items: { type: "string" } },
            },
            required: ["id", "title", "objective", "deliverables", "completionCriteria"],
          },
        },
      },
      required: ["title", "description", "tasks"],
    },
  },
};

export interface BuildReplaceDraftHandlerDeps {
  currentSession?: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
}

export function buildReplaceDraftHandler(deps: BuildReplaceDraftHandlerDeps = {}): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "session_unavailable" };
    }

    const title = String(args.title ?? "").trim();
    const description = String(args.description ?? "").trim();
    const tasksRaw = args.tasks;
    if (!title) {
      return { ok: false, reason: "missing_title", hint: "title 必填。" };
    }
    if (!Array.isArray(tasksRaw) || tasksRaw.length === 0) {
      return {
        ok: false,
        reason: "missing_tasks",
        hint: "tasks 须为非空数组。",
      };
    }

    const previousDraft = session.latestDraft as Record<string, unknown> | undefined;
    const draft: Record<string, unknown> = {
      title,
      description: description || title,
      tasks: tasksRaw,
    };

    const stabilized = stabilizeDraftTaskIds(draft, previousDraft);
    let normalized = normalizeDraftTasksForSession(
      preserveQualityPlanningContext(stabilized, previousDraft),
    );
    session.latestDraft = normalized as PlanSession["latestDraft"];
    clearPublishStagingOnDraft(session);
    deps.onSessionMutated?.(session);

    normalized = session.latestDraft as Record<string, unknown>;

    const taskCount = Array.isArray((normalized as { tasks?: unknown[] }).tasks)
      ? (normalized as { tasks: unknown[] }).tasks.length
      : 0;

    return {
      ok: true,
      taskCount,
      taskIds: Array.isArray((normalized as { tasks?: Array<{ id?: string }> }).tasks)
        ? (normalized as { tasks: Array<{ id?: string }> }).tasks
            .map((t) => String(t?.id ?? "").trim())
            .filter(Boolean)
        : [],
    };
  };
}
