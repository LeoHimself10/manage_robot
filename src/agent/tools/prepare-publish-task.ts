import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";

export const PREPARE_PUBLISH_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "prepare_publish_task",
    description:
      "在主管确认可发布后，整理正式任务发布 payload（仅准备，不落库发布）。返回结构化发布表单供主管确认。",
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

export function buildPreparePublishTaskHandler(): ToolHandler {
  return (args: Record<string, unknown>) => {
    const planId = String(args.planId ?? "").trim();
    const title = String(args.title ?? "").trim();
    const subtasks = Array.isArray(args.subtasks)
      ? args.subtasks.map((item) => {
          const row = item as Record<string, unknown>;
          return {
            taskId: String(row.taskId ?? "").trim(),
            title: String(row.title ?? "").trim(),
            assigneeUserId: String(row.assigneeUserId ?? "").trim(),
            objective: String(row.objective ?? "").trim() || undefined,
            dueAt: String(row.dueAt ?? "").trim() || undefined,
          };
        }).filter((item) => item.taskId && item.title && item.assigneeUserId)
      : [];
    if (!planId) throw new Error("planId is required");
    if (!title) throw new Error("title is required");
    if (subtasks.length === 0) throw new Error("subtasks must be a non-empty array");
    return {
      planId,
      title,
      subtasks,
      managerNote: String(args.managerNote ?? "").trim() || undefined,
      preparedAt: new Date().toISOString(),
      requiresManagerConfirm: true,
    };
  };
}
