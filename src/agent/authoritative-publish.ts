import type { PlanSession } from "../infra/plan-session-store";
import type { ToolHandler } from "./demo/qwen-compatible-client";
import {
  isDraftStagedForPublish,
  isPublishConfirmUserMessage,
} from "./publish-staging";

export function hasPublishableDraftInSession(session: PlanSession): boolean {
  const draft = session.latestDraft;
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return false;
  const tasks = (draft as { tasks?: unknown }).tasks;
  return Array.isArray(tasks) && tasks.length > 0;
}

/** 从 session 草案 + 指派表构造 prepare_publish_task 入参；缺负责人或 description 时返回 null。 */
export function buildPreparePublishArgsFromSession(
  session: PlanSession,
): Record<string, unknown> | null {
  const draft = session.latestDraft;
  if (!hasPublishableDraftInSession(session)) return null;
  const draftObj = draft as Record<string, unknown>;
  const title = String(draftObj.title ?? "").trim();
  const description = String(draftObj.description ?? draftObj.summary ?? "").trim();
  if (!title || !description) return null;

  const assignByTaskId = new Map<string, string>();
  const assignment = session.latestAssignment;
  if (assignment && typeof assignment === "object" && !Array.isArray(assignment)) {
    const rows = (assignment as { assignments?: unknown }).assignments;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        const taskId = String(r.taskId ?? "").trim();
        const primary = r.primary as Record<string, unknown> | undefined;
        const userId = String(primary?.userId ?? "").trim();
        if (taskId && userId) assignByTaskId.set(taskId, userId);
      }
    }
  }

  const tasks = draftObj.tasks as Array<Record<string, unknown>>;
  const subtasks: Array<Record<string, unknown>> = [];
  for (const t of tasks) {
    const taskId = String(t.id ?? "").trim();
    const stTitle = String(t.title ?? "").trim();
    const assigneeUserId = assignByTaskId.get(taskId) ?? "";
    if (!taskId || !stTitle || !assigneeUserId) return null;
    const timeNode = t.timeNode as Record<string, unknown> | undefined;
    const dueAt = String(timeNode?.dueAt ?? "").trim() || undefined;
    subtasks.push({
      taskId,
      title: stTitle,
      assigneeUserId,
      objective: String(t.objective ?? "").trim() || undefined,
      dueAt,
      feedbackFrequency: String(t.feedbackFrequency ?? "").trim() || undefined,
    });
  }
  if (subtasks.length === 0) return null;

  return {
    planId: session.planId,
    title,
    description,
    subtasks,
  };
}

export function publishResultSucceeded(result: Record<string, unknown> | undefined): boolean {
  return !!result && String(result.ok ?? "") === "true";
}

/**
 * 主管确认发布时由服务端执行 prepare（若未 staged）+ publish，不依赖模型口播。
 */
export async function runAuthoritativePublishOnConfirm(input: {
  session: PlanSession;
  userMessage: string;
  prepareHandler: ToolHandler;
  publishHandler: ToolHandler;
}): Promise<{
  publishResult?: Record<string, unknown>;
  prepareResult?: Record<string, unknown>;
  skippedReason?: string;
}> {
  if (!isPublishConfirmUserMessage(input.userMessage)) {
    return { skippedReason: "not_publish_confirm" };
  }
  if (!hasPublishableDraftInSession(input.session)) {
    return { skippedReason: "no_publishable_draft" };
  }

  let prepareResult: Record<string, unknown> | undefined;
  if (!isDraftStagedForPublish(input.session.latestDraft)) {
    const args = buildPreparePublishArgsFromSession(input.session);
    if (!args) {
      return { skippedReason: "cannot_build_prepare_args" };
    }
    const raw = await input.prepareHandler(args);
    prepareResult = raw as Record<string, unknown>;
    if (String(prepareResult.ok ?? "") !== "true") {
      return { prepareResult, skippedReason: "prepare_failed" };
    }
  }

  const publishRaw = await input.publishHandler({
    planId: input.session.planId,
    confirmationContext: String(input.userMessage ?? "").trim(),
  });
  const publishResult = publishRaw as Record<string, unknown>;
  return { publishResult, prepareResult };
}
