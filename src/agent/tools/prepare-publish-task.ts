import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";

export const PREPARE_PUBLISH_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "prepare_publish_task",
    description:
      "在主管确认可发布后，整理正式任务发布 payload 并把结构化草案 + 指派关系暂存到当前会话（落 session.latestDraft / latestAssignment）。仅此一步还不会真正写入正式任务表；必须在主管下一条消息中明确表达确认意愿后再调 publish_task。返回结构化发布表单供主管确认。",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        title: { type: "string" },
        subtasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              taskId: { type: "string" },
              title: { type: "string" },
              assigneeUserId: { type: "string" },
              objective: { type: "string" },
              dueAt: { type: "string" },
            },
            required: ["taskId", "title", "assigneeUserId"],
          },
        },
        managerNote: { type: "string" },
      },
      required: ["planId", "title", "subtasks"],
    },
  },
};

export interface BuildPreparePublishTaskHandlerDeps {
  /**
   * 当前会话引用。当本工具校验通过时，会把规整后的 draft + assignment 直接 mutate 到该对象上，
   * 让后续 publish_task 即便在模型最终 JSON 中没有显式 draft 字段也能读到结构化数据。
   * 兼容缺省（用于单测 / demo 链路）。
   */
  currentSession?: PlanSession;
}

export function buildPreparePublishTaskHandler(
  deps: BuildPreparePublishTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const planId = String(args.planId ?? "").trim();
    const title = String(args.title ?? "").trim();
    const rawSubtasks = Array.isArray(args.subtasks) ? args.subtasks : [];
    const normalizedSubtasks = rawSubtasks.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        taskId: String(row.taskId ?? "").trim(),
        title: String(row.title ?? "").trim(),
        assigneeUserId: String(row.assigneeUserId ?? "").trim(),
        objective: String(row.objective ?? "").trim() || undefined,
        dueAt: String(row.dueAt ?? "").trim() || undefined,
      };
    });
    const subtasks = normalizedSubtasks.filter(
      (item) => item.taskId && item.title && item.assigneeUserId,
    );

    if (!planId) {
      return {
        ok: false,
        reason: "missing_plan_id",
        hint: "调用前必须传入 planId（必须等于当前会话的 planId）。",
      };
    }
    if (!title) {
      return {
        ok: false,
        reason: "missing_title",
        hint: "调用前必须传入 title（计划标题）。",
      };
    }
    if (rawSubtasks.length === 0) {
      return {
        ok: false,
        reason: "missing_subtasks",
        hint: "subtasks 不能为空，请先在 message 给出至少一条带 taskId/title/assigneeUserId 的子任务。",
      };
    }
    const missingAssigneeTaskIds = normalizedSubtasks
      .filter((item) => item.taskId && item.title && !item.assigneeUserId)
      .map((item) => item.taskId);
    if (missingAssigneeTaskIds.length > 0) {
      return {
        ok: false,
        reason: "missing_assignee",
        missingTaskIds: missingAssigneeTaskIds,
        hint: `草案中以下子任务尚未指派负责人：${missingAssigneeTaskIds.join(", ")}。请先补齐 assigneeUserId 后再调用本工具。`,
      };
    }
    if (subtasks.length === 0) {
      return {
        ok: false,
        reason: "missing_subtasks",
        hint: "所有 subtask 至少要包含 taskId、title、assigneeUserId 三项；请补齐后再调用。",
      };
    }

    const managerNote = String(args.managerNote ?? "").trim() || undefined;
    const preparedAt = new Date().toISOString();

    // 把规整后的 draft + assignment 暂存到当前 session，保证 publish_task 能拿到结构化数据。
    if (deps.currentSession) {
      if (deps.currentSession.planId && deps.currentSession.planId !== planId) {
        return {
          ok: false,
          reason: "plan_mismatch",
          hint: `planId 与当前会话不匹配（会话 planId=${deps.currentSession.planId}，调用方传入=${planId}）。请使用当前会话的 planId。`,
        };
      }
      const stagedDraft: Record<string, unknown> = {
        title,
        tasks: subtasks.map((s) => ({
          id: s.taskId,
          title: s.title,
          objective: s.objective,
          timeNode: s.dueAt ? { dueAt: s.dueAt } : undefined,
        })),
        stagedBy: "prepare_publish_task",
        stagedAt: preparedAt,
      };
      const stagedAssignment: Record<string, unknown> = {
        assignments: subtasks.map((s) => ({
          taskId: s.taskId,
          primary: { userId: s.assigneeUserId },
          confidence: "HIGH",
        })),
        stagedBy: "prepare_publish_task",
        stagedAt: preparedAt,
      };
      deps.currentSession.latestDraft = stagedDraft;
      deps.currentSession.latestAssignment = stagedAssignment;
    }

    return {
      ok: true,
      planId,
      title,
      subtasks,
      managerNote,
      preparedAt,
      requiresManagerConfirm: true,
      staged: Boolean(deps.currentSession),
    };
  };
}
