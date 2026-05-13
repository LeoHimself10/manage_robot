import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import type { PlanSession } from "../../infra/plan-session-store";
import { createPlanSessionStore, resolvePlanSessionDir } from "../../infra/plan-session-store";
import { executeReassignWithSideEffects } from "../workbench/reassign-with-side-effects";

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
    description: "主管改派任务负责人（按 planId 改派全部未完成子任务），并同步写入会话修订事件。",
    parameters: {
      type: "object",
      properties: {
        actorUserId: { type: "string" },
        planId: { type: "string" },
        assigneeUserId: { type: "string" },
        note: { type: "string" },
        actorName: { type: "string" },
      },
      required: ["actorUserId", "planId", "assigneeUserId"],
    },
  },
};

export function buildReassignTaskHandler(
  deps: {
    taskStore?: ReturnType<typeof createWorkbenchFormalTaskStore>;
    planSessionStore?: ReturnType<typeof createPlanSessionStore>;
    findSessionByPlanId?: (planId: string) => (PlanSession & { chatKeyHash: string }) | undefined;
    patchAssignment?: (latest: Record<string, unknown> | undefined, assigneeUserId: string) => Record<string, unknown>;
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
    if (!actorUserId || !planId || !assigneeUserId) {
      throw new Error("actorUserId, planId, assigneeUserId are required");
    }
    const result = executeReassignWithSideEffects(
      {
        planId,
        managerUserId: actorUserId,
        assigneeUserId,
        note,
        actorName: actorName || undefined,
      },
      {
        taskStore,
        planSessionStore,
        findLatestSessionByPlanId: deps.findSessionByPlanId ?? findLatestSessionByPlanId,
        patchLatestAssignmentAssignee: deps.patchAssignment ?? patchLatestAssignmentAssignee,
      },
    );
    return {
      ok: true,
      task: result.task,
      assigneeUserId,
      revisionEventWritten: result.revisionEventWritten,
    };
  };
}
