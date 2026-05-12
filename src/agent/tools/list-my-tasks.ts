import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const LIST_MY_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_my_tasks",
    description: "列出当前员工本人名下任务（按 userId 限定作用域）。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
      },
      required: ["actorUserId"],
    },
  },
};

export function buildListMyTasksHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    if (!actorUserId) throw new Error("actorUserId is required");
    const tasks = taskStore.listEmployeeSubtasks(actorUserId).map((item) => ({
      subtaskId: item.subtaskId,
      taskNo: item.taskNo,
      planId: item.planId,
      title: item.title,
      status: item.status,
      dueAt: item.dueAt,
      managerUserId: item.managerUserId,
    }));
    return { actorUserId, tasks };
  };
}
