import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import { notifyManagerOfEmployeeActionAfterUpdate } from "../../integrations/dingtalk/manager-notify-on-employee-action";
import { notifyEmployeeTodoOnAcceptAfterUpdate } from "../../integrations/dingtalk/employee-todo-on-accept";

export const SUBMIT_EMPLOYEE_RESPONSE_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "submit_employee_response",
    description:
      "提交员工对任务的响应（accept/reject/request_changes/customize）。工具负责状态落库和审计。若用户只用任务标题/序号描述对象（如“第一个任务”“产线那个”）而未提供 subtaskId，请先调 list_my_tasks 拿到 subtaskId 再调本工具，不要反问用户索要 ID。",
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
        proposedDueAt: { type: "string", description: "员工自报截止日期（YYYY-MM-DD）" },
      },
      required: ["subtaskId", "action"],
    },
  },
};

export function buildSubmitEmployeeResponseHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    notifier?: WorkbenchPublishNotifier;
    getDisplayName?: (userId: string) => string | undefined;
    getContact?: (userId: string) => { unionId?: string } | undefined;
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  return async (args: Record<string, unknown>) => {
    const subtaskId = String(args.subtaskId ?? "").trim();
    const actorUserId = String(args.actorUserId ?? "").trim();
    const action = String(args.action ?? "").trim();
    const note = String(args.note ?? "").trim();
    const managerSummary = String(args.managerSummary ?? "").trim();
    const proposedDueAt = String(args.proposedDueAt ?? "").trim();
    if (!subtaskId) throw new Error("subtaskId is required");
    if (!actorUserId) throw new Error("actorUserId is required");
    if (!["accept", "reject", "request_changes", "customize"].includes(action)) {
      throw new Error("unsupported action");
    }
    if ((action === "reject" || action === "request_changes" || action === "customize") && !note) {
      throw new Error("note is required for reject/request_changes/customize");
    }
    const current = taskStore.getSubtaskWithTask(subtaskId);
    if (!current) throw new Error("Subtask not found");
    const needsSelfDue = !String(current.subtask.dueAt ?? "").trim()
      && String(current.subtask.dueSetBy ?? "") !== "manager";
    if (action === "accept" && needsSelfDue && !proposedDueAt) {
      return {
        ok: false,
        reason: "missing_proposed_due_at",
        hint: "该任务需承接时自报截止，请补充 proposedDueAt（YYYY-MM-DD）。",
      };
    }
    if (action === "accept" && proposedDueAt) {
      taskStore.setSubtaskDueAt({
        subtaskId,
        actorUserId,
        dueAt: proposedDueAt,
        dueSetBy: "employee",
        note: note || "员工承接时自报截止",
      });
    }
    const updated = taskStore.updateSubtaskStatus({
      subtaskId,
      actorUserId,
      action:
        action === "customize"
          ? "customize"
          : (action as "accept" | "reject" | "request_changes"),
      note,
    });
    await notifyEmployeeTodoOnAcceptAfterUpdate({
      taskStore,
      notifier: deps.notifier,
      subtaskId: updated.subtask.subtaskId,
      actorUserId,
      previousStatus: updated.previousStatus,
      action: action as "accept" | "reject" | "request_changes" | "customize",
      getContact: deps.getContact,
    });
    if (action === "reject" || action === "request_changes" || action === "customize") {
      const summaryText = (managerSummary || note).trim();
      if (summaryText) {
        taskStore.appendTaskEvent({
          taskId: updated.task.taskId,
          subtaskId: updated.subtask.subtaskId,
          eventType: "EMPLOYEE_RESPONSE_SUMMARY",
          actorUserId,
          note: summaryText,
          payload: {
            action,
          },
        });
      }
    }
    if (action === "reject") {
      await notifyManagerOfEmployeeActionAfterUpdate({
        taskStore,
        notifier: deps.notifier,
        subtaskId: updated.subtask.subtaskId,
        actorUserId,
        kind: "rejected",
        note,
        getDisplayName: deps.getDisplayName,
      });
    } else if (action === "request_changes") {
      await notifyManagerOfEmployeeActionAfterUpdate({
        taskStore,
        notifier: deps.notifier,
        subtaskId: updated.subtask.subtaskId,
        actorUserId,
        kind: "changes_requested",
        note,
        getDisplayName: deps.getDisplayName,
      });
    } else if (action === "customize") {
      await notifyManagerOfEmployeeActionAfterUpdate({
        taskStore,
        notifier: deps.notifier,
        subtaskId: updated.subtask.subtaskId,
        actorUserId,
        kind: "customize",
        note,
        getDisplayName: deps.getDisplayName,
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
