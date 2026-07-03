import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { PlanSession } from "../../infra/plan-session-store";
import { createPlanSessionStore, resolvePlanSessionDir } from "../../infra/plan-session-store";
import { executeReassignWithSideEffects } from "../workbench/reassign-with-side-effects";
import { voidFireReassignAssigneeNotify } from "../workbench/reassign-notify-side-effect";
import type { WorkbenchPublishNotifier } from "../../integrations/dingtalk/workbench-notify";
import type { DingTalkContactRow } from "../../infra/people-directory-store";
import {
  canAccessManagerOwnedObject,
  resolveWorkbenchManagerScope,
} from "../../security/workbench-manager-scope";

function findLatestSessionByPlanId(planId: string): (PlanSession & { chatKeyHash: string }) | undefined {
  try {
    const dir = resolvePlanSessionDir();
    if (!existsSync(dir)) return undefined;
    const sessions: Array<PlanSession & { chatKeyHash: string }> = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf8")) as PlanSession;
        const chatKeyHash =
          typeof raw.chatKeyHash === "string" ? raw.chatKeyHash : file.replace(/\.json$/, "");
        sessions.push({ ...raw, chatKeyHash });
      } catch {
        // ignore malformed session file
      }
    }
    const matched = sessions.filter((s) => s.planId === planId);
    matched.sort((a, b) => (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0));
    return matched[0];
  } catch {
    return undefined;
  }
}

function patchLatestAssignmentAssignee(
  latest: Record<string, unknown> | undefined,
  assigneeUserId: string,
): Record<string, unknown> {
  const base =
    latest && typeof latest === "object" && !Array.isArray(latest) ? { ...latest } : {};
  const assignments = Array.isArray(base.assignments) ? [...base.assignments] : [{}];
  const firstRaw = assignments[0];
  const first =
    typeof firstRaw === "object" && firstRaw !== null && !Array.isArray(firstRaw)
      ? { ...(firstRaw as Record<string, unknown>) }
      : {};
  const primaryRaw = first.primary;
  const primary =
    typeof primaryRaw === "object" && primaryRaw !== null && !Array.isArray(primaryRaw)
      ? { ...(primaryRaw as Record<string, unknown>) }
      : {};
  primary.userId = assigneeUserId;
  first.primary = primary;
  assignments[0] = first;
  return { ...base, assignments };
}

export const REASSIGN_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "reassign_task",
    description:
      "主管改派任务负责人。**作用范围由 subtaskId 决定**：传 subtaskId 仅改派该单个子任务；不传 subtaskId 则改派该 plan 下所有未完成子任务。请严格按用户意图选择——用户只说『把 task_4 改派给 X』时必须传 subtaskId，**不要**默认整 plan 改派。若用户用人名/任务标题描述对象，请先调 list_managed_tasks 解析 planId、调 get_task_detail 拿到 subtaskId、调 search_employees 解析 assigneeUserId，再调本工具，不要反问用户索要 ID。subtaskId 可传完整形（task:{planId}:task_4）也可传短码（task_4）。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        planId: { type: "string" },
        assigneeUserId: { type: "string" },
        subtaskId: {
          type: "string",
          description:
            "可选。传则仅改派该子任务；不传则整 plan 改派全部未完成子任务。接受完整形 task:{planId}:task_4 或短码 task_4。",
        },
        note: { type: "string" },
        actorName: { type: "string" },
      },
      required: ["planId", "assigneeUserId"],
    },
  },
};

export function buildReassignTaskHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    planSessionStore?: ReturnType<typeof createPlanSessionStore>;
    findSessionByPlanId?: (planId: string) => (PlanSession & { chatKeyHash: string }) | undefined;
    patchAssignment?: (latest: Record<string, unknown> | undefined, assigneeUserId: string) => Record<string, unknown>;
    notifier?: WorkbenchPublishNotifier;
    getDisplayName?: (userId: string) => string | undefined;
    getContact?: (userId: string) => DingTalkContactRow | undefined;
  } = {},
): ToolHandler {
  const taskStore = deps.taskStore ?? createWorkbenchFormalTaskStore();
  const planSessionStore = deps.planSessionStore ?? createPlanSessionStore();
  return (args: Record<string, unknown>) => {
    const actorUserId = String(args.actorUserId ?? "").trim();
    const planId = String(args.planId ?? "").trim();
    const assigneeUserId = String(args.assigneeUserId ?? "").trim();
    const note = String(args.note ?? "").trim();
    const actorName = String(args.actorName ?? "").trim();
    const subtaskIdRaw = String(args.subtaskId ?? "").trim();
    const subtaskId = subtaskIdRaw || undefined;
    if (!actorUserId || !planId || !assigneeUserId) {
      throw new Error("actorUserId, planId, assigneeUserId are required");
    }
    const detail = taskStore.getTaskDetail(planId);
    if (!detail) return { ok: false, reason: "task_not_found" };
    const scope = resolveWorkbenchManagerScope(actorUserId);
    if (!canAccessManagerOwnedObject(detail.task, scope)) {
      return { ok: false, reason: "task_not_owned", hint: "该任务不在你的管理范围" };
    }
    const managerUserIdForMutation = detail.task.managerUserId;
    const result = executeReassignWithSideEffects(
      {
        planId,
        managerUserId: managerUserIdForMutation,
        assigneeUserId,
        note,
        actorName: actorName || undefined,
        subtaskId,
      },
      {
        taskStore,
        planSessionStore,
        findLatestSessionByPlanId: deps.findSessionByPlanId ?? findLatestSessionByPlanId,
        patchLatestAssignmentAssignee: deps.patchAssignment ?? patchLatestAssignmentAssignee,
      },
    );
    if (deps.notifier) {
      const getDisplayName = deps.getDisplayName ?? ((uid) => deps.getContact?.(uid)?.name?.trim() ?? undefined);
      voidFireReassignAssigneeNotify({
        notifier: deps.notifier,
        getDisplayName,
        appendTaskEvent: taskStore.appendTaskEvent,
        taskStore,
        taskId: result.task.taskId,
        planId,
        managerUserId: managerUserIdForMutation,
        assigneeUserId,
        subtaskIdRaw: subtaskIdRaw || undefined,
      });
    }
    return {
      ok: true,
      task: result.task,
      assigneeUserId,
      subtaskId: subtaskId ?? null,
      scope: subtaskId ? "subtask" : "plan",
      revisionEventWritten: result.revisionEventWritten,
    };
  };
}
