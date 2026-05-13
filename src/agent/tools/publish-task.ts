import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";

type PublishFromSessionFn = (input: {
  planId: string;
  session: PlanSession;
  managerUserId: string;
  initiatorDepartment: string;
  actorUserId: string;
  actorName?: string;
}) => {
  task: { taskId: string; taskNo: string; title: string };
  subtasks: Array<{ assigneeUserId: string; title: string }>;
  alreadyPublished: boolean;
};

type AppendTaskEventFn = (input: {
  taskId: string;
  eventType: string;
  actorUserId: string;
  note?: string;
  payload?: Record<string, unknown>;
}) => void;

type GetContactFn = (userId: string) => { active?: boolean; unionId?: string } | undefined;

export interface PublishTaskRecentStore {
  get(planId: string): number | undefined;
  mark(planId: string): void;
}

export interface BuildPublishTaskHandlerDeps {
  trustedActorUserId?: string;
  currentSessionPlanId?: string;
  currentSession?: PlanSession;
  actorName?: string;
  initiatorDepartment: string;
  publishFromSession: PublishFromSessionFn;
  appendTaskEvent: AppendTaskEventFn;
  getContact: GetContactFn;
  notifier: WorkbenchPublishNotifier;
  recentPublished: PublishTaskRecentStore;
  onPublishResult?: (result: Record<string, unknown>) => void;
  onAudit?: (entry: {
    event: "publish_task_invoked";
    planId: string;
    actorUserId: string;
    confirmationContext: string;
    dedupedByLru: boolean;
    alreadyPublished: boolean;
  }) => void;
}

export const PUBLISH_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "publish_task",
    description:
      "把当前 planId 的草案 + 分配落到 SQLite 正式任务表并通知员工。调用前必须已调用 prepare_publish_task 给主管预览，且主管在最近回复中已明确表达确认意愿。若主管仍在提问或否定，请不要调用。幂等：同 planId 重复调用返回 alreadyPublished=true。",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        confirmationContext: {
          type: "string",
          description: "主管表达确认的原话（审计字段）。",
        },
      },
      required: ["planId"],
    },
  },
};

export function createRecentPublishStore(ttlMs = 60_000): PublishTaskRecentStore {
  const seen = new Map<string, number>();
  return {
    get(planId: string): number | undefined {
      const now = Date.now();
      const expiresAt = seen.get(planId);
      if (!expiresAt) return undefined;
      if (expiresAt <= now) {
        seen.delete(planId);
        return undefined;
      }
      return expiresAt;
    },
    mark(planId: string): void {
      const now = Date.now();
      seen.set(planId, now + ttlMs);
      for (const [key, expiresAt] of seen.entries()) {
        if (expiresAt <= now) seen.delete(key);
      }
    },
  };
}

export function buildPublishTaskHandler(deps: BuildPublishTaskHandlerDeps): ToolHandler {
  return async (args: Record<string, unknown>) => {
    const trustedActor = String(deps.trustedActorUserId ?? "").trim();
    if (!trustedActor) {
      return {
        ok: false,
        error: "trusted_actor_required",
      };
    }
    const planId = String(args.planId ?? "").trim();
    if (!planId) throw new Error("planId is required");
    if (deps.currentSessionPlanId && planId !== deps.currentSessionPlanId) {
      throw new Error("plan_mismatch");
    }
    const owner = String(deps.currentSession?.senderStaffId ?? "").trim();
    if (owner && owner !== trustedActor) {
      throw new Error("actor_not_owner");
    }
    const dedupedByLru = deps.recentPublished.get(planId) !== undefined;
    if (dedupedByLru) {
      const result = {
        ok: true,
        alreadyPublished: true,
        dedupedByLru: true,
      };
      deps.onPublishResult?.(result);
      deps.onAudit?.({
        event: "publish_task_invoked",
        planId,
        actorUserId: trustedActor,
        confirmationContext: String(args.confirmationContext ?? "").trim(),
        dedupedByLru: true,
        alreadyPublished: true,
      });
      return result;
    }
    const session = deps.currentSession;
    if (!session) throw new Error("session_not_found");

    const published = deps.publishFromSession({
      planId,
      session,
      managerUserId: trustedActor,
      initiatorDepartment: deps.initiatorDepartment,
      actorUserId: trustedActor,
      actorName: deps.actorName,
    });
    deps.recentPublished.mark(planId);

    const groupedAssignees = new Map<string, string[]>();
    published.subtasks.forEach((subtask) => {
      const current = groupedAssignees.get(subtask.assigneeUserId) ?? [];
      current.push(subtask.title);
      groupedAssignees.set(subtask.assigneeUserId, current);
    });
    const unionIdByUser = new Map<string, string | undefined>();
    for (const assigneeUserId of groupedAssignees.keys()) {
      const contact = deps.getContact(assigneeUserId);
      if (!contact || !contact.active) {
        throw new Error(`assignee is missing or inactive in contacts: ${assigneeUserId}`);
      }
      unionIdByUser.set(assigneeUserId, contact.unionId);
    }
    const warnings: string[] = [];
    const notifyResult = await deps.notifier.notifyPublishedTask({
      taskNo: published.task.taskNo,
      title: published.task.title,
      managerUserId: trustedActor,
      assignees: [...groupedAssignees.entries()].map(([userId, subtaskTitles]) => ({
        userId,
        unionId: unionIdByUser.get(userId),
        subtaskTitles,
      })),
    });
    if (!notifyResult.enabled) {
      warnings.push(notifyResult.skippedReason || "employee notification skipped");
      deps.appendTaskEvent({
        taskId: published.task.taskId,
        eventType: "EMPLOYEE_NOTIFY_SKIPPED",
        actorUserId: trustedActor,
        note: notifyResult.skippedReason || "notification disabled",
        payload: { taskNo: published.task.taskNo },
      });
    } else {
      notifyResult.success.forEach((item) => {
        deps.appendTaskEvent({
          taskId: published.task.taskId,
          eventType: "EMPLOYEE_NOTIFIED",
          actorUserId: trustedActor,
          note: `notified ${item.userId}`,
          payload: {
            userId: item.userId,
            cardMessageId: item.cardMessageId,
            todoId: item.todoId,
            taskNo: published.task.taskNo,
          },
        });
      });
      notifyResult.failed.forEach((item) => {
        warnings.push(`通知失败: ${item.userId}`);
        deps.appendTaskEvent({
          taskId: published.task.taskId,
          eventType: "EMPLOYEE_NOTIFY_FAILED",
          actorUserId: trustedActor,
          note: item.reason,
          payload: {
            userId: item.userId,
            taskNo: published.task.taskNo,
          },
        });
      });
    }
    deps.onAudit?.({
      event: "publish_task_invoked",
      planId,
      actorUserId: trustedActor,
      confirmationContext: String(args.confirmationContext ?? "").trim(),
      dedupedByLru: false,
      alreadyPublished: published.alreadyPublished,
    });
    const result = {
      ok: true,
      alreadyPublished: published.alreadyPublished,
      dedupedByLru: false,
      task: published.task,
      subtasks: published.subtasks,
      warnings,
    };
    deps.onPublishResult?.(result);
    return result;
  };
}
