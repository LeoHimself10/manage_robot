import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const ADMIN_LIST_ALL_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "admin_list_all_tasks",
    description: "管理员查看全量任务列表（可按 status/department/taskNo/assignee/keyword 过滤）。",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string" },
        department: { type: "string" },
        taskNo: { type: "string" },
        assignee: { type: "string" },
        keyword: { type: "string" },
      },
      required: [],
    },
  },
};

export function buildAdminListAllTasksHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const tasks = taskStore.listAdminTasks({
      status: String(args.status ?? "").trim(),
      department: String(args.department ?? "").trim(),
      taskNo: String(args.taskNo ?? "").trim(),
      assignee: String(args.assignee ?? "").trim(),
      keyword: String(args.keyword ?? "").trim(),
    });
    return { ok: true, tasks };
  };
}
