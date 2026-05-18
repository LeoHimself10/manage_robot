import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { TASK_DESCRIPTION_MAX_DB } from "../../infra/workbench-formal-task-store";

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
        objective: {
          type: "string",
          description:
            "任务整体目标/业务诉求：给主管和员工看的一段话，说清楚「做什么、达成什么」；会写入正式任务表并下发通知/工作台。",
        },
        background: {
          type: "string",
          description:
            "触发背景/来由：说清楚「为什么有这个任务」；会与 objective 合并后写入正式任务表。",
        },
      },
      required: ["planId", "title", "objective", "subtasks"],
    },
  },
};

export interface BuildPreparePublishTaskHandlerDeps {
  currentSession?: PlanSession;
  getContact?: (userId: string) => { active?: boolean; unionId?: string } | undefined;
}

export function buildPreparePublishTaskHandler(
  deps: BuildPreparePublishTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const planId = String(args.planId ?? "").trim();
    const title = String(args.title ?? "").trim();
    const objective = String(args.objective ?? "").trim();
    const background = String(args.background ?? "").trim();
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
    if (!objective) {
      return {
        ok: false,
        reason: "missing_objective",
        hint:
          "调用前必须传入非空 objective：以面向员工的视角写清任务整体目标与业务诉求；该字段会随正式任务、钉钉通知与员工工作台展示。",
      };
    }

    // 合并 objective + background 作为 description 写入数据库，长度限制沿用
    const derivedDescription = background
      ? `${objective}\n\n${background}`
      : objective;
    if (derivedDescription.length > TASK_DESCRIPTION_MAX_DB) {
      return {
        ok: false,
        reason: "description_too_long",
        hint: `objective + background 合并后不得超过 ${TASK_DESCRIPTION_MAX_DB} 字符，请精简后重试。`,
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

    if (deps.getContact) {
      const unknown: Array<{ taskId: string; assigneeUserId: string }> = [];
      for (const s of subtasks) {
        const contact = deps.getContact(s.assigneeUserId);
        if (!contact || contact.active === false) {
          unknown.push({ taskId: s.taskId, assigneeUserId: s.assigneeUserId });
        }
      }
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: "unknown_assignees",
          unknown,
          hint:
            `以下 assigneeUserId 不在钉钉通讯录中（可能为假 ID 或已离职）：${unknown
              .map((u) => `${u.taskId}->${u.assigneeUserId}`)
              .join("；")}。**禁止编造 userId**：请先调用 search_employees（用真实姓名做 name 关键词）拿到通讯录里的真实 userId，再重新调用本工具。`,
        };
      }
    }

    const managerNote = String(args.managerNote ?? "").trim() || undefined;
    const preparedAt = new Date().toISOString();

    if (deps.currentSession) {
      if (deps.currentSession.planId && deps.currentSession.planId !== planId) {
        return {
          ok: false,
          reason: "plan_mismatch",
          hint: `planId 与当前会话不匹配（会话 planId=${deps.currentSession.planId}，调用方传入=${planId}）。请使用当前会话的 planId。`,
        };
      }
      const existingDraft = asPlainObject(deps.currentSession.latestDraft);
      const existingTasks = Array.isArray(existingDraft?.tasks)
        ? (existingDraft.tasks as Array<Record<string, unknown>>)
        : [];
      const existingTaskById = new Map<string, Record<string, unknown>>();
      for (const task of existingTasks) {
        const id = String((task as Record<string, unknown>)?.id ?? "").trim();
        if (id) existingTaskById.set(id, task);
      }
      const mergedTasks = subtasks.map((s) => mergeSubtaskPatch(existingTaskById.get(s.taskId), s));
      const stagedDraft: Record<string, unknown> = {
        ...(existingDraft ?? {}),
        title,
        objective,
        background,
        // description 派生，供下游仍使用 description 的地方读取
        description: derivedDescription,
        tasks: mergedTasks,
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
      objective,
      background,
      subtasks,
      managerNote,
      preparedAt,
      requiresManagerConfirm: true,
      staged: Boolean(deps.currentSession),
    };
  };
}

function asPlainObject(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

function mergeSubtaskPatch(
  originalTask: Record<string, unknown> | undefined,
  patch: { taskId: string; title: string; objective?: string; dueAt?: string },
): Record<string, unknown> {
  const next = { ...(originalTask ?? {}) };
  next.id = patch.taskId;
  next.title = patch.title;
  if (patch.objective !== undefined) next.objective = patch.objective;
  const rawTimeNode = asPlainObject(next.timeNode) ?? {};
  if (patch.dueAt !== undefined) {
    next.timeNode = { ...rawTimeNode, dueAt: patch.dueAt };
  } else if (Object.keys(rawTimeNode).length > 0) {
    next.timeNode = rawTimeNode;
  }
  return next;
}
