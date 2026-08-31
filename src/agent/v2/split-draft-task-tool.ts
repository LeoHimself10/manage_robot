/**
 * Atomic row-split tool (v2-only).
 *
 * Bundles update_draft_task (in-place rewrite of the source row) with one or
 * more add_draft_subtask inserts so the model only decides *how* to split while
 * code handles the mechanical two-step write sequence.
 */
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { buildUpdateDraftTaskHandler } from "../tools/update-draft-task";
import { buildAddDraftSubtaskHandler } from "../tools/mutate-draft-subtasks";
import { findDraftTaskIndex } from "../draft-task-ids";

export const SPLIT_DRAFT_TASK_TOOL_NAME = "split_draft_task";

export const SPLIT_DRAFT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: SPLIT_DRAFT_TASK_TOOL_NAME,
    description:
      "【单行拆分首选·原子工具】将草案中某一条子任务一次性拆成两条或多条并行工作包："
      + "第一条覆盖原 taskId（update），其余依次插入其后（add_draft_subtask）。"
      + "只拆用户点名的那一行，其他行不动；禁止整表 replace_draft。"
      + "tasks 至少 2 条；未给 dueAt 时继承原行截止日期。",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "要拆分的 draft.tasks[].id（如 task_1、task_2）",
        },
        tasks: {
          type: "array",
          minItems: 2,
          items: {
            type: "object",
            properties: {
              title: { type: "string", description: "拆分后子任务标题（必填）" },
              objective: { type: "string", description: "可选。目标。" },
              deliverables: {
                type: "array",
                items: { type: "string" },
                description: "可选。交付物列表。",
              },
              completionCriteria: {
                type: "array",
                items: { type: "string" },
                description: "可选。验收标准。",
              },
              dueAt: {
                type: "string",
                description: "可选。截止日期 ISO 或 yyyy-MM-dd；缺省继承原行。",
              },
              actions: {
                type: "array",
                items: { type: "string" },
                description: "可选。执行动作。",
              },
              dependencyTaskIds: {
                type: "array",
                items: { type: "string" },
                description: "可选。前置依赖 taskId。",
              },
            },
            required: ["title"],
          },
        },
      },
      required: ["taskId", "tasks"],
    },
  },
};

export interface SplitDraftTaskToolDeps {
  currentSession?: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
  getContact?: (userId: string) => { active?: boolean; name?: string } | undefined;
}

function readDefaultDueAt(task: Record<string, unknown> | undefined): string {
  const timeNode = task?.timeNode as { dueAt?: string } | undefined;
  return String(timeNode?.dueAt ?? "").trim();
}

function buildPatchFromSplitRow(
  row: Record<string, unknown>,
  defaultDueAt: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    title: String(row.title ?? "").trim(),
  };
  const objective = String(row.objective ?? "").trim();
  if (objective) patch.objective = objective;
  const dueAt = String(row.dueAt ?? "").trim() || defaultDueAt;
  if (dueAt) patch.dueAt = dueAt;
  if (Array.isArray(row.deliverables) && row.deliverables.length > 0) {
    patch.deliverables = row.deliverables;
  }
  if (Array.isArray(row.completionCriteria) && row.completionCriteria.length > 0) {
    patch.completionCriteria = row.completionCriteria;
  }
  if (Array.isArray(row.actions) && row.actions.length > 0) {
    patch.actions = row.actions;
  }
  if (Array.isArray(row.dependencyTaskIds) && row.dependencyTaskIds.length > 0) {
    patch.dependencyTaskIds = row.dependencyTaskIds;
  }
  return patch;
}

export function buildSplitDraftTaskHandler(deps: SplitDraftTaskToolDeps): ToolHandler {
  const updateHandler = buildUpdateDraftTaskHandler({
    currentSession: deps.currentSession,
    getContact: deps.getContact,
  });
  const addHandler = buildAddDraftSubtaskHandler({
    currentSession: deps.currentSession,
  });

  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }

    const taskId = String(args.taskId ?? "").trim();
    const rawTasks = Array.isArray(args.tasks) ? (args.tasks as unknown[]) : [];
    if (!taskId) {
      return { ok: false, reason: "missing_task_id", hint: "taskId 必填。" };
    }
    if (rawTasks.length < 2) {
      return {
        ok: false,
        reason: "tasks_too_few",
        hint: "tasks 至少 2 条（拆分后第一条覆盖原行，其余为新增）。",
      };
    }

    const draft = session.latestDraft as { tasks?: Array<Record<string, unknown>> } | undefined;
    const tasks = draft?.tasks ?? [];
    if (tasks.length === 0) {
      return { ok: false, reason: "no_draft", hint: "当前无草案 tasks[]。" };
    }
    const sourceIdx = findDraftTaskIndex(tasks, taskId);
    if (sourceIdx === -1) {
      const known = tasks.map((t) => String(t.id ?? "").trim()).filter(Boolean);
      return {
        ok: false,
        reason: "unknown_task_id",
        taskId,
        hint: `taskId=${taskId} 不在当前草案。已有：${known.join("、")}`,
      };
    }

    const sourceTask = tasks[sourceIdx];
    const defaultDueAt = readDefaultDueAt(sourceTask);
    const parsedRows = rawTasks
      .filter((item) => item && typeof item === "object")
      .map((item) => item as Record<string, unknown>)
      .filter((row) => String(row.title ?? "").trim());

    if (parsedRows.length < 2) {
      return {
        ok: false,
        reason: "tasks_too_few",
        hint: "tasks 中至少 2 条须含非空 title。",
      };
    }

    const updateResult = updateHandler({
      subtaskId: taskId,
      patch: buildPatchFromSplitRow(parsedRows[0], defaultDueAt),
    }) as Record<string, unknown>;
    if (updateResult.ok !== true) {
      return { ...updateResult, stage: "update_first_row" };
    }

    const createdIds: string[] = [taskId];
    let insertAfter = taskId;
    for (let i = 1; i < parsedRows.length; i += 1) {
      const row = parsedRows[i];
      const addArgs: Record<string, unknown> = {
        title: String(row.title ?? "").trim(),
        insertAfterSubtaskId: insertAfter,
      };
      const objective = String(row.objective ?? "").trim();
      if (objective) addArgs.objective = objective;
      const dueAt = String(row.dueAt ?? "").trim() || defaultDueAt;
      if (dueAt) addArgs.dueAt = dueAt;

      const addResult = addHandler(addArgs) as Record<string, unknown>;
      if (addResult.ok !== true) {
        return {
          ...addResult,
          stage: "add_split_row",
          partialSplit: true,
          createdIds,
        };
      }
      const newId = String(addResult.subtaskId ?? "").trim();
      if (newId) {
        const detailResult = updateHandler({
          subtaskId: newId,
          patch: buildPatchFromSplitRow(row, defaultDueAt),
        }) as Record<string, unknown>;
        if (detailResult.ok !== true) {
          return {
            ...detailResult,
            stage: "hydrate_split_row",
            partialSplit: true,
            createdIds,
            createdTaskId: newId,
          };
        }
        createdIds.push(newId);
        insertAfter = newId;
      }
    }

    deps.onSessionMutated?.(session);

    const finalTasks = (session.latestDraft as { tasks?: Array<{ id?: unknown }> } | undefined)
      ?.tasks ?? [];
    const allTaskIds = finalTasks.map((t) => String(t?.id ?? "").trim()).filter(Boolean);

    return {
      ok: true,
      sourceTaskId: taskId,
      splitInto: createdIds.length,
      taskIds: createdIds,
      tasksCount: allTaskIds.length,
      // Return all draft taskIds so the model knows the full set for bulk_assign_tasks.
      allTaskIds,
      hint:
        `已将 ${taskId} 拆成 ${createdIds.length} 条：${createdIds.join("、")}。`
        + ` 当前草案共 ${allTaskIds.length} 条，全部 taskId：${allTaskIds.join("、")}。`,
    };
  };
}
