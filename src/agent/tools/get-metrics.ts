import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const GET_METRICS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_metrics",
    description: "读取管理员工作台任务指标（总任务、活跃任务、阻塞/待处理/完成子任务、按部门统计）。",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
};

export function buildGetMetricsHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return () => ({
    ok: true,
    metrics: taskStore.getMetrics(),
  });
}
