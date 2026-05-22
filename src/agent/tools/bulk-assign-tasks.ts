import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import {
  getEmployeeSearchHit,
  isUserIdAllowedForAssignment,
} from "../employee-search-cache";
import { getAssignmentCoverage } from "../assignment/merge-assignment";
import { upsertAssignmentRow } from "./update-draft-task";
import { clearPublishStagingOnDraft } from "../draft-staging-clear";

export interface BulkAssignRow {
  taskId: string;
  assigneeUserId: string;
  collaborators?: string[];
}

export const BULK_ASSIGN_TASKS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "bulk_assign_tasks",
    description:
      "一次性为当前草案全部 subtask 写入负责人（scheme C：写入 latestAssignment，不写 draft.tasks）。" +
      "assignments 须覆盖 draft.tasks 中的每一个 taskId；禁止用多次 update_draft_task 逐条指派。",
    parameters: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              taskId: { type: "string", description: "draft.tasks[].id" },
              assigneeUserId: { type: "string", description: "search_employees 命中或 candidatePool 内的 userId" },
              collaborators: {
                type: "array",
                items: { type: "string" },
                description: "协作人 displayName（可选）",
              },
            },
            required: ["taskId", "assigneeUserId"],
          },
        },
      },
      required: ["assignments"],
    },
  },
};

export interface BuildBulkAssignTasksHandlerDeps {
  currentSession?: PlanSession;
  getContact?: (userId: string) => { active?: boolean; unionId?: string; name?: string } | undefined;
}

export function buildBulkAssignTasksHandler(
  deps: BuildBulkAssignTasksHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "session_unavailable" };
    }

    const rawRows = args.assignments;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return {
        ok: false,
        reason: "missing_assignments",
        hint: "assignments 须为非空数组，且覆盖全部 draft taskId。",
      };
    }

    const draft = session.latestDraft as
      | { tasks?: Array<Record<string, unknown>> }
      | undefined;
    const tasks = draft?.tasks ?? [];
    if (tasks.length === 0) {
      return { ok: false, reason: "no_draft", hint: "当前无草案 tasks[]。" };
    }

    const taskIds = tasks
      .map((t) => String(t?.id ?? "").trim())
      .filter(Boolean);
    const allowedTaskIds = new Set(taskIds);

    const seen = new Set<string>();
    const rows: BulkAssignRow[] = [];
    for (const item of rawRows) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const taskId = String(row.taskId ?? "").trim();
      const assigneeUserId = String(row.assigneeUserId ?? "").trim();
      if (!taskId || !assigneeUserId) continue;
      if (!allowedTaskIds.has(taskId)) {
        return {
          ok: false,
          reason: "unknown_task_id",
          taskId,
          hint: `taskId=${taskId} 不在当前草案。已有：${taskIds.join("、")}`,
        };
      }
      if (seen.has(taskId)) {
        return { ok: false, reason: "duplicate_task_id", taskId };
      }
      seen.add(taskId);
      if (!isUserIdAllowedForAssignment(session, assigneeUserId)) {
        return {
          ok: false,
          reason: "assignee_not_from_search",
          taskId,
          assigneeUserId,
          hint: "assigneeUserId 须来自 search_employees 或 candidatePool。",
        };
      }
      if (deps.getContact) {
        const contact = deps.getContact(assigneeUserId);
        if (!contact || contact.active === false) {
          return {
            ok: false,
            reason: "invalid_assignee_user_id",
            taskId,
            assigneeUserId,
          };
        }
      }
      rows.push({
        taskId,
        assigneeUserId,
        collaborators: Array.isArray(row.collaborators)
          ? row.collaborators.map((c) => String(c ?? "").trim()).filter(Boolean)
          : undefined,
      });
    }

    const missingTaskIds = taskIds.filter((id) => !seen.has(id));
    if (missingTaskIds.length > 0) {
      return {
        ok: false,
        reason: "partial_assignment",
        missingTaskIds,
        hint: `须覆盖全部 ${taskIds.length} 条 taskId；仍缺：${missingTaskIds.join("、")}`,
      };
    }

    for (const row of rows) {
      const hit = getEmployeeSearchHit(session, row.assigneeUserId);
      const displayName =
        hit?.displayName
        ?? deps.getContact?.(row.assigneeUserId)?.name?.trim()
        ?? row.assigneeUserId;
      upsertAssignmentRow(session, row.taskId, {
        assigneeUserId: row.assigneeUserId,
        assigneeDisplayName: displayName,
        collaborators: row.collaborators,
      });
    }

    clearPublishStagingOnDraft(session);

    const coverage = getAssignmentCoverage(
      session.latestDraft as Record<string, unknown>,
      session.latestAssignment as Record<string, unknown>,
    );

    return {
      ok: true,
      assignedCount: rows.length,
      taskIds,
      coverage,
      hint: `已为 ${rows.length} 条 subtask 写入负责人。`,
    };
  };
}
