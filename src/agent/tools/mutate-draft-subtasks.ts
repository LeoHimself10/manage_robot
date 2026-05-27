import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { clearPublishStagingOnDraft } from "../draft-staging-clear";
import {
  allocTaskId,
  collectUsedTaskIds,
  findDraftTaskIndex,
} from "../draft-task-ids";
import { normalizeDraftTasksForSession, stripDeprecatedPlanningFieldsOnTask } from "../draft-person-fields";

function getDraftTasks(session: PlanSession): Array<Record<string, unknown>> | undefined {
  const draft = session.latestDraft as { tasks?: unknown[] } | undefined;
  if (!draft || !Array.isArray(draft.tasks) || draft.tasks.length === 0) return undefined;
  return draft.tasks as Array<Record<string, unknown>>;
}

function removeAssignmentRow(session: PlanSession, taskId: string): void {
  const assignment = (session.latestAssignment as
    | { assignments?: Array<Record<string, unknown>> }
    | undefined) ?? {};
  const assignments = Array.isArray(assignment.assignments) ? assignment.assignments : [];
  const next = assignments.filter((a) => String(a.taskId ?? "") !== taskId);
  session.latestAssignment = { ...assignment, assignments: next } as Record<string, unknown>;
}

function scrubDependencyReferences(
  tasks: Array<Record<string, unknown>>,
  removedId: string,
): void {
  for (const t of tasks) {
    const deps = Array.isArray(t.dependencyTaskIds) ? (t.dependencyTaskIds as string[]) : [];
    if (deps.length === 0) continue;
    const filtered = deps.filter((d) => String(d).trim() !== removedId);
    if (filtered.length !== deps.length) {
      t.dependencyTaskIds = filtered;
    }
  }
}

export const ADD_DRAFT_SUBTASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "add_draft_subtask",
    description:
      "在 session.latestDraft.tasks[] 末尾（或 insertAfterSubtaskId 之后）新增一条子任务。用于用户要求「加一条/新增子任务」；**禁止**为增一条而整表重出 draft JSON。新增后须 message 简述新 task id。",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "子任务标题（必填）。" },
        objective: { type: "string", description: "可选。子任务目标。" },
        dueAt: { type: "string", description: "可选。截止日期 ISO 或 yyyy-MM-dd。" },
        insertAfterSubtaskId: {
          type: "string",
          description: "可选。插入到该 subtaskId 之后；缺省追加到列表末尾。拆分场景常用；未传 dueAt 时继承被插入行的截止日期。",
        },
      },
      required: ["title"],
    },
  },
};

export const REMOVE_DRAFT_SUBTASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "remove_draft_subtask",
    description:
      "从 session.latestDraft.tasks[] 删除一条子任务，并同步移除 latestAssignment 对应行、清理其他 task 的 dependencyTaskIds。至少保留 1 条子任务。用户要求删/去掉某条时用；**禁止**整表重出 draft 代替删除。",
    parameters: {
      type: "object",
      properties: {
        subtaskId: {
          type: "string",
          description: "要删除的 subtaskId（如 task_2）。",
        },
      },
      required: ["subtaskId"],
    },
  },
};

export interface BuildMutateDraftSubtasksHandlerDeps {
  currentSession?: PlanSession;
}

export function buildAddDraftSubtaskHandler(
  deps: BuildMutateDraftSubtasksHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "session_unavailable", hint: "无可用 session。" };
    }
    const title = String(args.title ?? "").trim();
    if (!title) {
      return { ok: false, reason: "missing_title", hint: "title 必填。" };
    }
    const tasks = getDraftTasks(session);
    if (!tasks) {
      return {
        ok: false,
        reason: "no_draft",
        hint: "当前 scope 没有 latestDraft，请先生成草案。",
      };
    }
    const draft = session.latestDraft as { tasks: Array<Record<string, unknown>> };
    const used = collectUsedTaskIds(tasks);
    const newId = allocTaskId(tasks.length, used);
    const objective = String(args.objective ?? "").trim() || "待补充";
    let dueAt = String(args.dueAt ?? "").trim();
    const insertAfter = String(args.insertAfterSubtaskId ?? "").trim();
    let insertIdx = -1;
    if (insertAfter) {
      insertIdx = findDraftTaskIndex(tasks, insertAfter);
      if (insertIdx === -1) {
        return {
          ok: false,
          reason: "subtask_not_found",
          hint: `未找到 insertAfterSubtaskId=${insertAfter}。`,
        };
      }
      if (!dueAt) {
        const parentTn = tasks[insertIdx]?.timeNode as { dueAt?: string } | undefined;
        dueAt = String(parentTn?.dueAt ?? "").trim();
      }
    }
    const newTask: Record<string, unknown> = stripDeprecatedPlanningFieldsOnTask({
      id: newId,
      title,
      objective,
      deliverables: [],
      completionCriteria: [],
      timeNode: dueAt ? { dueAt } : {},
    });
    if (insertIdx >= 0) {
      tasks.splice(insertIdx + 1, 0, newTask);
    } else {
      tasks.push(newTask);
    }
    draft.tasks = tasks;
    session.latestDraft = normalizeDraftTasksForSession(draft);
    clearPublishStagingOnDraft(session);
    return {
      ok: true,
      subtaskId: newId,
      tasksCount: tasks.length,
      after: newTask,
      hint: `已新增子任务 ${newId}「${title}」。局部修改请继续用 update_draft_task；勿整表重出 draft。`,
    };
  };
}

export function buildRemoveDraftSubtaskHandler(
  deps: BuildMutateDraftSubtasksHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "session_unavailable", hint: "无可用 session。" };
    }
    const subtaskId = String(args.subtaskId ?? "").trim();
    if (!subtaskId) {
      return { ok: false, reason: "missing_subtask_id", hint: "subtaskId 必填。" };
    }
    const tasks = getDraftTasks(session);
    if (!tasks) {
      return { ok: false, reason: "no_draft", hint: "当前 scope 没有 latestDraft。" };
    }
    if (tasks.length <= 1) {
      return {
        ok: false,
        reason: "last_subtask",
        hint: "至少保留 1 条子任务；若要换题请 start_new_task。",
      };
    }
    const idx = findDraftTaskIndex(tasks, subtaskId);
    if (idx === -1) {
      const knownIds = tasks.map((t) => String(t.id ?? "").trim()).filter(Boolean);
      return {
        ok: false,
        reason: "subtask_not_found",
        hint: `未找到 ${subtaskId}。已有：${knownIds.join("、")}`,
      };
    }
    const removed = tasks[idx];
    const removedId = String(removed.id ?? "").trim();
    tasks.splice(idx, 1);
    const draft = session.latestDraft as { tasks: Array<Record<string, unknown>> };
    draft.tasks = tasks;
    if (removedId) {
      removeAssignmentRow(session, removedId);
      scrubDependencyReferences(tasks, removedId);
    }
    clearPublishStagingOnDraft(session);
    return {
      ok: true,
      removedSubtaskId: removedId || subtaskId,
      tasksCount: tasks.length,
      hint: `已删除子任务 ${removedId || subtaskId}；剩余 ${tasks.length} 条。发布前若曾 prepare，请重新 prepare_publish_task。`,
    };
  };
}
