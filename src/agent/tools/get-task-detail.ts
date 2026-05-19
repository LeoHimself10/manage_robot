import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { WorkbenchSubtaskRow } from "../../infra/workbench-formal-task-store";

export const GET_TASK_DETAIL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_task_detail",
    description:
      "查看任务详情（task + subtasks + events）。manager 仅可看本人管理任务；employee 可看本人子任务并可选择附带兄弟分工摘要；admin 不受限。钉钉免登链路由系统注入当前操作者身份，arguments 中 actorUserId/actorRole 可省略。若用户只描述任务标题/关键词而未提供 ID，请先调 list_managed_tasks（manager）或 list_my_tasks（employee）或 admin_list_all_tasks（admin）找到 taskNo/planId 再调本工具，不要反问用户索要 ID。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        actorRole: {
          type: "string",
          enum: ["admin", "manager", "employee"],
        },
        taskNo: { type: "string" },
        taskId: { type: "string" },
        planId: { type: "string" },
        includeSiblings: {
          type: "boolean",
          description:
            "仅 employee 有效：是否返回他人子任务摘要（title/负责人/状态）。默认 true；false 时仅返回本人子任务。",
        },
      },
      required: [],
    },
  },
};

function subtaskIdFromEventRow(row: Record<string, unknown>): string {
  return String(row.subtask_id ?? row.subtaskId ?? "").trim();
}

function mapSiblingForEmployee(sub: WorkbenchSubtaskRow, resolveName: (uid: string) => string) {
  return {
    subtaskId: sub.subtaskId,
    sourceTaskKey: sub.sourceTaskKey,
    title: sub.title,
    assigneeUserId: sub.assigneeUserId,
    assigneeDisplayName: resolveName(sub.assigneeUserId) || sub.assigneeUserId,
    status: sub.status,
  };
}

export function buildGetTaskDetailHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    actorRole?: "admin" | "manager" | "employee";
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const people = createPeopleDirectoryStore();
  const resolveName = (userId: string): string =>
    people.getContact(userId)?.name?.trim() ?? "";

  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    const role = String(deps.actorRole ?? args.actorRole ?? "").trim();
    const actorRole =
      role === "admin" || role === "manager" || role === "employee"
        ? role
        : undefined;
    if (!actorUserId) {
      return { ok: false, reason: "missing_actor", hint: "系统未识别身份" };
    }
    if (!actorRole) {
      return { ok: false, reason: "missing_role", hint: "系统未识别角色" };
    }
    const key =
      String(args.taskNo ?? "").trim() ||
      String(args.taskId ?? "").trim() ||
      String(args.planId ?? "").trim();
    if (!key) {
      return { ok: false, reason: "missing_key", hint: "未提供任务编号或 ID" };
    }
    const includeSiblings = args.includeSiblings !== false;
    const detail = taskStore.getTaskDetail(key);
    if (!detail) {
      return {
        ok: false,
        reason: "task_not_found",
        hint: "未在工作台查到该任务编号",
        queriedKey: key,
      };
    }
    if (actorRole === "manager" && detail.task.managerUserId !== actorUserId) {
      return { ok: false, reason: "task_not_owned", hint: "该任务不在你的管理范围" };
    }
    if (actorRole === "employee") {
      const own = detail.subtasks.some((subtask) => subtask.assigneeUserId === actorUserId);
      if (!own) {
        return { ok: false, reason: "task_not_owned", hint: "该任务不在你的管理范围" };
      }
      const mySubtaskIds = new Set(
        detail.subtasks.filter((s) => s.assigneeUserId === actorUserId).map((s) => s.subtaskId),
      );
      const filteredEvents = detail.events.filter((row) => {
        const r = row as Record<string, unknown>;
        const sid = subtaskIdFromEventRow(r);
        if (!sid) return true;
        return mySubtaskIds.has(sid);
      });
      const mySubtasks = detail.subtasks.filter((subtask) => subtask.assigneeUserId === actorUserId);
      const siblings = includeSiblings
        ? detail.subtasks
            .filter((subtask) => subtask.assigneeUserId !== actorUserId)
            .map((s) => mapSiblingForEmployee(s, resolveName))
        : [];
      return {
        ok: true,
        actorRole,
        task: detail.task,
        subtasks: mySubtasks,
        mySubtasks,
        siblings,
        events: filteredEvents,
        includeSiblings,
      };
    }
    return {
      ok: true,
      actorRole,
      task: detail.task,
      subtasks: detail.subtasks,
      events: detail.events,
    };
  };
}
