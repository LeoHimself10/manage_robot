import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const LIST_MY_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_my_tasks",
    description:
      "列出当前员工本人名下任务（按 userId 限定作用域）。含任务标题/背景摘要、子任务目标、截止、依赖、检查点、输入材料、执行动作、协作人、范围边界（详情请用 get_task_detail）。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
      },
      required: [],
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
      taskTitle: item.taskTitle,
      taskDescription: item.taskDescription,
      objective: item.objective,
      dependsOn: item.extra?.dependsOn,
      checkpoints: item.extra?.checkpoints,
      inputMaterials: item.extra?.inputMaterials,
      actions: item.extra?.actions,
      collaborators: item.extra?.collaborators,
      scope: item.extra?.scope,
    }));
    return { actorUserId, tasks };
  };
}
