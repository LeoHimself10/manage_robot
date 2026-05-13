import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { scheduleProfileCaseWorkerAfterDone } from "../profile/profile-case-worker";

export const SUBMIT_PROGRESS_UPDATE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_progress_update",
    description:
      "提交员工任务进度（IN_PROGRESS/BLOCKED/DONE）并记录说明。若用户未提供 subtaskId，请先调 list_my_tasks 拿到对应 subtaskId 再调本工具，不要反问用户索要 ID。",
    parameters: {
      type: "object",
      properties: {
        subtaskId: { type: "string" },
        actorUserId: { type: "string" },
        progressStatus: {
          type: "string",
          enum: ["IN_PROGRESS", "BLOCKED", "DONE"],
        },
        note: { type: "string" },
      },
      required: ["subtaskId", "progressStatus", "note"],
    },
  },
};

export function buildSubmitProgressUpdateHandler(
  deps: { taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore> } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return (args: Record<string, unknown>) => {
    const subtaskId = String(args.subtaskId ?? "").trim();
    const actorUserId = String(args.actorUserId ?? "").trim();
    const progressStatus = String(args.progressStatus ?? "").trim();
    const note = String(args.note ?? "").trim();
    if (!subtaskId || !actorUserId || !progressStatus || !note) {
      throw new Error("subtaskId, actorUserId, progressStatus and note are required");
    }
    const normalized =
      progressStatus === "DONE"
        ? "DONE"
        : progressStatus === "BLOCKED"
          ? "BLOCKED"
          : "IN_PROGRESS";
    const updated = taskStore.updateSubtaskStatus({
      subtaskId,
      actorUserId,
      action: "progress",
      note,
      progressStatus: normalized,
    });
    if (normalized === "DONE") {
      scheduleProfileCaseWorkerAfterDone({ subtaskId, assigneeUserId: actorUserId });
    }
    return {
      ok: true,
      progressStatus: updated.subtask.status,
      taskStatus: updated.task.status,
      subtaskId: updated.subtask.subtaskId,
      planId: updated.task.planId,
    };
  };
}
