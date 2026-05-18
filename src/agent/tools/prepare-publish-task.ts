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
        description: {
          type: "string",
          description:
            "面向员工的任务整体背景：目标、来由、验收口径、不做什么；会写入正式任务表并下发通知/工作台。",
        },
      },
      required: ["planId", "title", "description", "subtasks"],
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
  /**
   * 通讯录查询。用于在 stage 之前校验每个 assigneeUserId 都是真实在职钉钉账号，
   * 防止模型把姓名 → 假 userId（如 "u_yanghexin"）写进 session，进而污染正式任务表
   * 且通知通道全部静默失败。返回 undefined 或 active=false 即视为该 userId 非法。
   * 兼容缺省：未注入时跳过该校验（仅 demo / 单测）。
   */
  getContact?: (userId: string) => { active?: boolean; unionId?: string } | undefined;
}

export function buildPreparePublishTaskHandler(
  deps: BuildPreparePublishTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const planId = String(args.planId ?? "").trim();
    const title = String(args.title ?? "").trim();
    const description = String(args.description ?? "").trim();
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
    if (!description) {
      return {
        ok: false,
        reason: "missing_description",
        hint:
          "调用前必须传入非空 description：以面向员工的视角写清任务整体目标、来由、验收口径与不做什么；该字段会随正式任务、钉钉通知与员工工作台展示。",
      };
    }
    if (description.length > TASK_DESCRIPTION_MAX_DB) {
      return {
        ok: false,
        reason: "description_too_long",
        hint: `description 不得超过 ${TASK_DESCRIPTION_MAX_DB} 字符，请精简后重试。`,
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

    // 校验所有 assigneeUserId 必须是通讯录里真实存在且 active 的钉钉账号。
    // 关键防线：阻止模型把"姓名 -> 假 userId"（如 u_yanghexin）写进 session 进而污染正式任务表。
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

    // 把规整后的 draft + assignment 暂存到当前 session，保证 publish_task 能拿到结构化数据。
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
        description,
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
      description,
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
  if (patch.objective !== undefined) {
    next.objective = patch.objective;
  }
  const rawTimeNode = asPlainObject(next.timeNode) ?? {};
  if (patch.dueAt !== undefined) {
    next.timeNode = { ...rawTimeNode, dueAt: patch.dueAt };
  } else if (Object.keys(rawTimeNode).length > 0) {
    next.timeNode = rawTimeNode;
  }
  return next;
}
