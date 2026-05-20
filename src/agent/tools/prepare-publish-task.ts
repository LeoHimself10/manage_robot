import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";
import { TASK_DESCRIPTION_MAX_DB } from "../../infra/workbench-formal-task-store";
import { stripPlanningPersonFieldsFromTask } from "../draft-person-fields";
import {
  buildPreparePublishArgsFromSession,
  hashAssignmentForStaging,
  hashDraftForStaging,
  hasPublishableDraftInSession,
} from "../publish-helpers";
import { isDraftStagedForPublish } from "../publish-staging";

export const PREPARE_PUBLISH_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "prepare_publish_task",
    description:
      "在主管确认可发布后，从 session.latestDraft（结构）+ latestAssignment（负责人/协作人）组装发布预览并暂存。**subtasks 由服务端从 session 读取**，模型只需传 planId、title、description（可省略 title/description 时用 session 草案值）。仅此一步还不会写入正式任务表；主管下一条明确确认后再调 publish_task。",
    parameters: {
      type: "object",
      properties: {
        planId: { type: "string" },
        title: { type: "string" },
        managerNote: { type: "string" },
        description: {
          type: "string",
          description:
            "面向员工的任务整体背景；缺省时用 session.latestDraft.description。",
        },
        subtasks: {
          type: "array",
          description: "已废弃：服务端从 session 组装，传入也会被忽略。",
          items: { type: "object" },
        },
      },
      required: ["planId"],
    },
  },
};

export interface BuildPreparePublishTaskHandlerDeps {
  currentSession?: PlanSession;
  searchEmployeesQuotaExhausted?: () => boolean;
  getContact?: (userId: string) => { active?: boolean; unionId?: string } | undefined;
}

function asPlainObject(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  return input as Record<string, unknown>;
}

interface SubtaskPatch {
  taskId: string;
  title: string;
  assigneeUserId: string;
  objective?: string;
  dueAt?: string;
  feedbackFrequency?: string;
  deliverables?: string[];
  completionCriteria?: string[];
  dependencyTaskIds?: string[];
  checkpoints?: string[];
  risksAndOpenQuestions?: string[];
  inputMaterials?: string[];
  actions?: string[];
  collaborators?: string[];
  scope?: { inScope: string[]; outOfScope: string[] };
}

function mergeSubtaskPatch(
  originalTask: Record<string, unknown> | undefined,
  patch: SubtaskPatch,
): Record<string, unknown> {
  const next = stripPlanningPersonFieldsFromTask({ ...(originalTask ?? {}) });
  next.id = patch.taskId;
  next.title = patch.title;
  if (patch.objective !== undefined) next.objective = patch.objective;
  if (patch.feedbackFrequency !== undefined) next.feedbackFrequency = patch.feedbackFrequency;

  const arrayFields = [
    "deliverables", "completionCriteria", "dependencyTaskIds",
    "checkpoints", "risksAndOpenQuestions", "inputMaterials", "actions",
  ] as const;
  for (const f of arrayFields) {
    const v = patch[f];
    if (Array.isArray(v) && v.length > 0) next[f] = v;
  }

  const rawTimeNode = asPlainObject(next.timeNode) ?? {};
  if (patch.dueAt !== undefined) {
    next.timeNode = { ...rawTimeNode, dueAt: patch.dueAt };
  } else if (Object.keys(rawTimeNode).length > 0) {
    next.timeNode = rawTimeNode;
  }

  if (patch.checkpoints !== undefined && Array.isArray(patch.checkpoints) && patch.checkpoints.length > 0) {
    const tn = asPlainObject(next.timeNode) ?? {};
    next.timeNode = { ...tn, checkpoints: patch.checkpoints };
  }

  if (patch.scope !== undefined) {
    const existingScope = asPlainObject(next.scope) ?? {};
    next.scope = {
      inScope:
        Array.isArray(patch.scope.inScope) && patch.scope.inScope.length > 0
          ? patch.scope.inScope
          : (existingScope.inScope ?? []),
      outOfScope:
        Array.isArray(patch.scope.outOfScope) && patch.scope.outOfScope.length > 0
          ? patch.scope.outOfScope
          : (existingScope.outOfScope ?? []),
    };
  }

  return next;
}

export function buildPreparePublishTaskHandler(
  deps: BuildPreparePublishTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    if (deps.searchEmployeesQuotaExhausted?.()) {
      return {
        ok: false,
        reason: "search_employees_quota_exhausted",
        hint:
          "本轮 search_employees 已达上限且点将尚未完成。请先让用户用**姓名（部门）**明确负责人，或输出/修订 JSON draft；**禁止**在未完成点将时调用 prepare_publish_task。",
      };
    }

    const planId = String(args.planId ?? "").trim();
    if (!planId) {
      return {
        ok: false,
        reason: "missing_plan_id",
        hint: "调用前必须传入 planId（必须等于当前会话的 planId）。",
      };
    }

    if (!deps.currentSession) {
      return {
        ok: false,
        reason: "session_unavailable",
        hint: "无可用 session，无法从 latestDraft/latestAssignment 组装发布预览。",
      };
    }

    if (deps.currentSession.planId && deps.currentSession.planId !== planId) {
      return {
        ok: false,
        reason: "plan_mismatch",
        hint: `planId 与当前会话不匹配（会话 planId=${deps.currentSession.planId}，调用方传入=${planId}）。`,
      };
    }

    if (!hasPublishableDraftInSession(deps.currentSession)) {
      return {
        ok: false,
        reason: "no_draft",
        hint: "当前 session 没有可发布的 latestDraft.tasks，请先生成草案并完成点将。",
      };
    }

    const draftObj = deps.currentSession.latestDraft as Record<string, unknown>;
    const draftDescription = String(draftObj.description ?? draftObj.summary ?? "").trim();
    const argDescription = String(args.description ?? "").trim();
    if (!draftDescription && !argDescription) {
      return {
        ok: false,
        reason: "missing_description",
        hint:
          "缺少 description：须写清任务整体目标、来由、验收口径；可写入 session.latestDraft.description 或本工具参数。",
      };
    }

    const sessionBuilt = buildPreparePublishArgsFromSession(deps.currentSession);
    if (!sessionBuilt) {
      return {
        ok: false,
        reason: "missing_assignee",
        hint: "部分子任务缺少负责人。请先用 update_draft_task 或 ASSIGN 写入 latestAssignment，再 prepare。",
      };
    }

    const title = String(args.title ?? sessionBuilt.title ?? "").trim();
    const description = argDescription || draftDescription;
    const subtasks = (sessionBuilt.subtasks as SubtaskPatch[]) ?? [];

    if (!title) {
      return { ok: false, reason: "missing_title", hint: "缺少 title（session 草案也无标题）。" };
    }
    if (description.length > TASK_DESCRIPTION_MAX_DB) {
      return {
        ok: false,
        reason: "description_too_long",
        hint: `description 不得超过 ${TASK_DESCRIPTION_MAX_DB} 字符，请精简后重试。`,
      };
    }

    const missingAssigneeTaskIds = subtasks
      .filter((item) => item.taskId && item.title && !item.assigneeUserId)
      .map((item) => item.taskId);
    if (missingAssigneeTaskIds.length > 0) {
      return {
        ok: false,
        reason: "missing_assignee",
        missingTaskIds: missingAssigneeTaskIds,
        hint: `以下子任务尚未指派负责人：${missingAssigneeTaskIds.join(", ")}。请先补齐 latestAssignment 后再调用本工具。`,
      };
    }

    if (deps.getContact) {
      const unknown: Array<{ taskId: string; assigneeUserId: string }> = [];
      for (const s of subtasks) {
        const contact = deps.getContact(s.assigneeUserId);
        if (!contact || contact.active === false) {
          unknown.push({ taskId: s.taskId, assigneeUserId: s.assigneeUserId });
        }
      }
      if (unknown.length > 0) {
        return {
          ok: false,
          reason: "unknown_assignees",
          unknown,
          hint:
            `以下 assigneeUserId 不在钉钉通讯录中：${unknown
              .map((u) => `${u.taskId}->${u.assigneeUserId}`)
              .join("；")}。**禁止编造 userId**：请先 search_employees 再 update_draft_task。`,
        };
      }
    }

    const draftHash = hashDraftForStaging(deps.currentSession.latestDraft);
    const assignmentHash = hashAssignmentForStaging(deps.currentSession.latestAssignment);
    if (
      isDraftStagedForPublish(deps.currentSession.latestDraft)
      && (deps.currentSession.latestDraft as Record<string, unknown>).stagedDraftHash === draftHash
      && (deps.currentSession.latestDraft as Record<string, unknown>).stagedAssignmentHash === assignmentHash
    ) {
      return {
        ok: true,
        reason: "already_staged",
        planId,
        title,
        description,
        subtasks,
        preparedAt: String((deps.currentSession.latestDraft as Record<string, unknown>).stagedAt ?? ""),
        requiresManagerConfirm: true,
        staged: true,
        hint: "当前草案与指派已与上次 prepare 一致，无需重复 prepare；请等待主管确认后调用 publish_task。",
      };
    }

    const managerNote = String(args.managerNote ?? "").trim() || undefined;
    const preparedAt = new Date().toISOString();

    const existingDraft = asPlainObject(deps.currentSession.latestDraft);
    const existingTasks = Array.isArray(existingDraft?.tasks)
      ? (existingDraft.tasks as Array<Record<string, unknown>>)
      : [];
    const existingTaskById = new Map<string, Record<string, unknown>>();
    for (const task of existingTasks) {
      const id = String(task?.id ?? "").trim();
      if (id) existingTaskById.set(id, task);
    }
    const mergedTasks = subtasks.map((s) => mergeSubtaskPatch(existingTaskById.get(s.taskId), s));
    const draftBodyForHash: Record<string, unknown> = {
      ...(existingDraft ?? {}),
      title,
      description,
      tasks: mergedTasks,
    };
    const stagedAssignment: Record<string, unknown> = {
      assignments: subtasks.map((s) => ({
        taskId: s.taskId,
        primary: { userId: s.assigneeUserId },
        ...(s.collaborators?.length ? { collaborators: s.collaborators } : {}),
        confidence: "HIGH",
      })),
      stagedBy: "prepare_publish_task",
      stagedAt: preparedAt,
    };
    const stagedDraft: Record<string, unknown> = {
      ...draftBodyForHash,
      stagedBy: "prepare_publish_task",
      stagedAt: preparedAt,
      stagedDraftHash: hashDraftForStaging(draftBodyForHash),
      stagedAssignmentHash: hashAssignmentForStaging(stagedAssignment),
    };
    deps.currentSession.latestDraft = stagedDraft;
    deps.currentSession.latestAssignment = stagedAssignment;

    return {
      ok: true,
      planId,
      title,
      description,
      subtasks,
      managerNote,
      preparedAt,
      requiresManagerConfirm: true,
      staged: true,
    };
  };
}
