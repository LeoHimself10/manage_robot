import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const GET_TASK_DETAIL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_task_detail",
    description:
      "查看任务详情（task + subtasks + events）。manager 仅可看本人管理任务；employee 仅可看分配给自己的子任务；admin 不受限。钉钉免登链路由系统注入当前操作者身份，arguments 中 actorUserId/actorRole 可省略。若用户只描述任务标题/关键词而未提供 ID，请先调 list_managed_tasks（manager）或 list_my_tasks（employee）或 admin_list_all_tasks（admin）找到 taskNo/planId 再调本工具，不要反问用户索要 ID。",
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
      },
      required: [],
    },
  },
};

export function buildGetTaskDetailHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    actorRole?: "admin" | "manager" | "employee";
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    const role = String(deps.actorRole ?? args.actorRole ?? "").trim();
    const actorRole =
      role === "admin" || role === "manager" || role === "employee"
        ? role
        : undefined;
    if (!actorUserId) throw new Error("actorUserId is required");
    if (!actorRole) throw new Error("actorRole is required");
    const key =
      String(args.taskNo ?? "").trim() ||
      String(args.taskId ?? "").trim() ||
      String(args.planId ?? "").trim();
    if (!key) throw new Error("taskNo or taskId or planId is required");
    const detail = taskStore.getTaskDetail(key);
    if (!detail) throw new Error("Task not found");
    if (actorRole === "manager" && detail.task.managerUserId !== actorUserId) {
      throw new Error("Task does not belong to current manager");
    }
    if (actorRole === "employee") {
      const own = detail.subtasks.some((subtask) => subtask.assigneeUserId === actorUserId);
      if (!own) {
        throw new Error("Task does not belong to current employee");
      }
      return {
        ok: true,
        actorRole,
        task: detail.task,
        subtasks: detail.subtasks.filter((subtask) => subtask.assigneeUserId === actorUserId),
        events: detail.events,
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
