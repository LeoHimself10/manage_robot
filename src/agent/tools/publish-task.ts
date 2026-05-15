import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { WorkbenchSubtaskExtra } from "../../infra/workbench-formal-task-store";

type PublishFromSessionFn = (input: {
  planId: string;
  session: PlanSession;
  managerUserId: string;
  initiatorDepartment: string;
  actorUserId: string;
  actorName?: string;
}) => {
  task: { taskId: string; taskNo: string; title: string };
  subtasks: Array<{
    assigneeUserId: string;
    title: string;
    sourceTaskKey: string;
    extra?: WorkbenchSubtaskExtra;
  }>;
  alreadyPublished: boolean;
};

type AppendTaskEventFn = (input: {
  taskId: string;
  eventType: string;
  actorUserId: string;
  note?: string;
  payload?: Record<string, unknown>;
}) => void;

type GetContactFn = (userId: string) =>
  | { active?: boolean; unionId?: string; name?: string }
  | undefined;

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

    let published: ReturnType<PublishFromSessionFn>;
    try {
      published = deps.publishFromSession({
        planId,
        session,
        managerUserId: trustedActor,
        initiatorDepartment: deps.initiatorDepartment,
        actorUserId: trustedActor,
        actorName: deps.actorName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("latestDraft.tasks is empty")) {
        return {
          ok: false,
          reason: "no_draft_in_session",
          hint:
            "当前会话尚未暂存可发布的结构化草案。请先调用 prepare_publish_task 把 planId/title/subtasks(含 assigneeUserId) 完整传入并让主管确认，再调用 publish_task。**不要假装任务已发布**。",
        };
      }
      if (message.startsWith("Missing assignee for subtask")) {
        const taskIdMatch = message.match(/Missing assignee for subtask\s+(\S+)/);
        const missingTaskId = taskIdMatch ? taskIdMatch[1] : "(unknown)";
        return {
          ok: false,
          reason: "missing_assignee",
          missingTaskId,
          hint:
            `子任务 ${missingTaskId} 仍缺少负责人。请重新调用 prepare_publish_task 把所有 subtasks 的 assigneeUserId 补齐，让主管再次确认后再发布。`,
        };
      }
      throw error;
    }
    deps.recentPublished.mark(planId);

    const groupedAssignees = new Map<string, Array<{ title: string; extra?: WorkbenchSubtaskExtra }>>();
    published.subtasks.forEach((subtask) => {
      const current = groupedAssignees.get(subtask.assigneeUserId) ?? [];
      current.push({ title: subtask.title, extra: subtask.extra });
      groupedAssignees.set(subtask.assigneeUserId, current);
    });
    const subtaskTitleBySourceKey: Record<string, string> = {};
    for (const sub of published.subtasks) {
      if (sub.sourceTaskKey) subtaskTitleBySourceKey[sub.sourceTaskKey] = sub.title;
    }
    const unionIdByUser = new Map<string, string | undefined>();
    const unknownAssignees: string[] = [];
    for (const assigneeUserId of groupedAssignees.keys()) {
      const contact = deps.getContact(assigneeUserId);
      if (!contact || !contact.active) {
        unknownAssignees.push(assigneeUserId);
        continue;
      }
      unionIdByUser.set(assigneeUserId, contact.unionId);
    }
    if (unknownAssignees.length > 0) {
      // 防御层：即使 prepare_publish_task 未校验通过、或被绕过，正式任务表此刻已落库，
      // 但通讯录里查不到这些 userId 意味着所有通知通道都会静默失败。
      // 把失败状态明确写入 task_events + warnings，并以 ok:false 返回，
      // 让模型如实告知用户「负责人不存在」，而不是错以为发布成功。
      const reason = `assignees_not_in_contacts: ${unknownAssignees.join(", ")}`;
      deps.appendTaskEvent({
        taskId: published.task.taskId,
        eventType: "EMPLOYEE_NOTIFY_SKIPPED",
        actorUserId: trustedActor,
        note: reason,
        payload: {
          taskNo: published.task.taskNo,
          unknownAssignees,
        },
      });
      const result = {
        ok: false,
        reason: "unknown_assignees",
        unknownAssignees,
        taskNo: published.task.taskNo,
        planId,
        hint:
          `正式任务表已创建（taskNo=${published.task.taskNo}），但以下 assigneeUserId 不在钉钉通讯录中：${unknownAssignees.join("、")}。通知通道全部跳过。请提示主管：① 已写库的这条任务事实上无人收到通知，② 需要先用 search_employees 拿到真实 userId，③ 然后调用 reassign_task 把任务改派到真实人员，或决定是否把这条任务作废。**不要谎称任务已成功发布**。`,
      };
      deps.onPublishResult?.(result);
      return result;
    }
    const managerContact = deps.getContact(trustedActor);
    const managerDisplayName = managerContact?.name?.trim() || undefined;
    const warnings: string[] = [];
    const notifyResult = await deps.notifier.notifyPublishedTask({
      taskNo: published.task.taskNo,
      title: published.task.title,
      managerUserId: trustedActor,
      managerDisplayName,
      taskDescription: published.task.description,
      subtaskTitleBySourceKey,
      assignees: [...groupedAssignees.entries()].map(([userId, subtasks]) => ({
        userId,
        displayName: deps.getContact(userId)?.name?.trim() || undefined,
        unionId: unionIdByUser.get(userId),
        subtasks,
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
            robotMessageKey: item.robotMessageKey,
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
