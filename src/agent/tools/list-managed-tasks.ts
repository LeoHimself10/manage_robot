import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const LIST_MANAGED_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_managed_tasks",
    description:
      "列出当前主管名下的任务。admin 调用此工具只会看到其本人作为 manager 的任务；查看全局请使用 admin_list_all_tasks。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
      },
      required: [],
    },
  },
};

export function buildListManagedTasksHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    if (!actorUserId) throw new Error("actorUserId is required");
    const tasks = taskStore.listManagerTasks(actorUserId);
    return { ok: true, actorUserId, tasks };
  };
}
