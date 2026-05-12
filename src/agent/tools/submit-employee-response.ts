import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";

export const SUBMIT_EMPLOYEE_RESPONSE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_employee_response",
    description:
      "提交员工对任务的响应（accept/reject/request_changes/customize）。工具负责状态落库和审计。",
    parameters: {
      type: "object",
      properties: {
        subtaskId: { type: "string" },
        actorUserId: { type: "string" },
        action: {
          type: "string",
          enum: ["accept", "reject", "request_changes", "customize"],
        },
        note: { type: "string" },
        managerSummary: { type: "string" },
      },
      required: ["subtaskId", "actorUserId", "action"],
    },
  },
};

export function buildSubmitEmployeeResponseHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const subtaskId = String(args.subtaskId ?? "").trim();
    const actorUserId = String(args.actorUserId ?? "").trim();
    const action = String(args.action ?? "").trim();
    const note = String(args.note ?? "").trim();
    const managerSummary = String(args.managerSummary ?? "").trim();
    if (!subtaskId) throw new Error("subtaskId is required");
    if (!actorUserId) throw new Error("actorUserId is required");
    if (!["accept", "reject", "request_changes", "customize"].includes(action)) {
      throw new Error("unsupported action");
    }
    if ((action === "reject" || action === "request_changes" || action === "customize") && !note) {
      throw new Error("note is required for reject/request_changes/customize");
    }
    const updated = taskStore.updateSubtaskStatus({
      subtaskId,
      actorUserId,
      action: action === "customize" ? "request_changes" : (action as "accept" | "reject" | "request_changes"),
      note,
    });
    if ((action === "reject" || action === "request_changes" || action === "customize") && managerSummary) {
      taskStore.appendTaskEvent({
        taskId: updated.task.taskId,
        subtaskId: updated.subtask.subtaskId,
        eventType: "EMPLOYEE_RESPONSE_SUMMARY",
        actorUserId,
        note: managerSummary,
        payload: {
          action,
        },
      });
    }
    return {
      ok: true,
      action,
      taskStatus: updated.task.status,
      subtaskStatus: updated.subtask.status,
      subtaskId: updated.subtask.subtaskId,
      planId: updated.task.planId,
      managerSummary: managerSummary || undefined,
    };
  };
}
