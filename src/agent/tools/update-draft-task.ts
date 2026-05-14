import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";

export const UPDATE_DRAFT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_draft_task",
    description:
      "在当前 session.latestDraft 中原地修改单个子任务的字段（title/objective/dueAt/assigneeUserId）。用于用户说「task_3 的截止时间改一下」「task_4 改派给王五」等局部修改，**避免重新生成整张草案**而触发主题串台。assigneeUserId 必须是 dingtalk_contacts 里的真实在职 userId。",
    parameters: {
      type: "object",
      properties: {
        subtaskId: {
          type: "string",
          description: "要修改的 subtaskId（短码如 task_3 或带 plan 前缀均可，会按 id 字段匹配）。",
        },
        patch: {
          type: "object",
          description: "要更新的字段。未列出的字段保持不变。",
          properties: {
            title: { type: "string" },
            objective: { type: "string" },
            dueAt: { type: "string" },
            assigneeUserId: { type: "string" },
          },
        },
      },
      required: ["subtaskId", "patch"],
    },
  },
};

export interface BuildUpdateDraftTaskHandlerDeps {
  currentSession?: PlanSession;
  getContact?: (userId: string) => { active?: boolean; unionId?: string } | undefined;
}

export function buildUpdateDraftTaskHandler(
  deps: BuildUpdateDraftTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return {
        ok: false,
        reason: "session_unavailable",
        hint: "无可用 session（仅在 demo/单测时可能出现）。",
      };
    }
    const subtaskId = String(args.subtaskId ?? "").trim();
    const patchRaw = (args.patch ?? {}) as Record<string, unknown>;
    if (!subtaskId) {
      return { ok: false, reason: "missing_subtask_id", hint: "subtaskId 必填。" };
    }
    const draft = session.latestDraft as
      | { tasks?: Array<Record<string, unknown>>; title?: unknown }
      | undefined;
    if (!draft || !Array.isArray(draft.tasks) || draft.tasks.length === 0) {
      return {
        ok: false,
        reason: "no_draft",
        hint:
          "当前 scope 没有 latestDraft，无法局部修改。请先用 prepare_publish_task 或常规链路生成草案，再调用本工具。",
      };
    }

    const targetIdx = draft.tasks.findIndex((t) => {
      const id = String((t as { id?: unknown }).id ?? "").trim();
      return id === subtaskId || id.endsWith(`:${subtaskId}`) || subtaskId.endsWith(`:${id}`);
    });
    if (targetIdx === -1) {
      const knownIds = draft.tasks
        .map((t) => String((t as { id?: unknown }).id ?? "").trim())
        .filter(Boolean);
      return {
        ok: false,
        reason: "subtask_not_found",
        hint: `未在当前草案找到 subtaskId=${subtaskId}。已有：${knownIds.join("、") || "(空)"}`,
      };
    }

    const patch = {
      title: typeof patchRaw.title === "string" ? patchRaw.title.trim() : undefined,
      objective: typeof patchRaw.objective === "string" ? patchRaw.objective.trim() : undefined,
      dueAt: typeof patchRaw.dueAt === "string" ? patchRaw.dueAt.trim() : undefined,
      assigneeUserId:
        typeof patchRaw.assigneeUserId === "string" ? patchRaw.assigneeUserId.trim() : undefined,
    };
    const hasAnyField =
      patch.title !== undefined
      || patch.objective !== undefined
      || patch.dueAt !== undefined
      || patch.assigneeUserId !== undefined;
    if (!hasAnyField) {
      return {
        ok: false,
        reason: "empty_patch",
        hint: "patch 至少要包含 title / objective / dueAt / assigneeUserId 之一。",
      };
    }

    if (patch.assigneeUserId && deps.getContact) {
      const contact = deps.getContact(patch.assigneeUserId);
      if (!contact || contact.active === false) {
        return {
          ok: false,
          reason: "unknown_assignee",
          unknown: { subtaskId, assigneeUserId: patch.assigneeUserId },
          hint:
            `assigneeUserId=${patch.assigneeUserId} 不在钉钉通讯录或已离职。` +
            "请先调 search_employees 拿到真实 userId 再重试。",
        };
      }
    }

    const target = draft.tasks[targetIdx] as Record<string, unknown>;
    const updatedFields: string[] = [];
    if (patch.title) {
      target.title = patch.title;
      updatedFields.push("title");
    }
    if (patch.objective) {
      target.objective = patch.objective;
      updatedFields.push("objective");
    }
    if (patch.dueAt) {
      const tn = (target.timeNode as Record<string, unknown> | undefined) ?? {};
      tn.dueAt = patch.dueAt;
      target.timeNode = tn;
      updatedFields.push("dueAt");
    }
    if (patch.assigneeUserId) {
      const assignment = (session.latestAssignment as
        | { assignments?: Array<Record<string, unknown>> }
        | undefined) ?? {};
      const assignments = Array.isArray(assignment.assignments) ? assignment.assignments : [];
      const targetTaskId = String(target.id ?? "");
      let row = assignments.find((a) => String(a.taskId ?? "") === targetTaskId);
      if (!row) {
        row = { taskId: targetTaskId, primary: {}, confidence: "HIGH" };
        assignments.push(row);
      }
      const primary = (row.primary as Record<string, unknown> | undefined) ?? {};
      primary.userId = patch.assigneeUserId;
      row.primary = primary;
      session.latestAssignment = { ...assignment, assignments } as Record<string, unknown>;
      updatedFields.push("assigneeUserId");
    }

    return {
      ok: true,
      subtaskId,
      updatedFields,
      after: target,
      hint:
        `已更新 subtaskId=${subtaskId} 的 ${updatedFields.join(", ")}。` +
        "如需推送给员工，记得在后续轮次调用 prepare_publish_task → publish_task 重新发布或 reassign_task。",
    };
  };
}
