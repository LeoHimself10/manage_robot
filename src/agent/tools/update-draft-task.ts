import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type { PlanSession } from "../../infra/plan-session-store";

const EXTRA_LIST_MAX_ITEMS = 10;
const EXTRA_ITEM_MAX_CHARS = 200;

function normalizePatchStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const item of input) {
    if (out.length >= EXTRA_LIST_MAX_ITEMS) break;
    const s = String(item ?? "").trim();
    if (!s) continue;
    out.push(s.length > EXTRA_ITEM_MAX_CHARS ? s.slice(0, EXTRA_ITEM_MAX_CHARS) : s);
  }
  return out;
}

export const UPDATE_DRAFT_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "update_draft_task",
    description:
      "在当前 session.latestDraft 中原地修改单个子任务的字段（title/objective/dueAt/assigneeUserId/dependencyTaskIds/checkpoints/risks/inputMaterials/actions/collaborators/scope）。用于局部修改，**避免重新生成整张草案**而触发主题串台。数组类字段为**整表替换**：须先基于当前草案合并后再提交完整数组；**例外**：`scope` 仅可传 `{ inScope?, outOfScope? }` 的一边或两边，未出现的键保留原值。assigneeUserId 必须是 dingtalk_contacts 里的真实在职 userId。",
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
            dependencyTaskIds: {
              type: "array",
              items: { type: "string" },
              description: "前置依赖 task id 列表（如 task_1）；写入草案 dependencyTaskIds，发布后进 extra.dependsOn。",
            },
            checkpoints: {
              type: "array",
              items: { type: "string" },
              description: "检查点列表；写入 timeNode.checkpoints。",
            },
            risks: {
              type: "array",
              items: { type: "string" },
              description: "风险与待澄清；写入 risksAndOpenQuestions。",
            },
            inputMaterials: {
              type: "array",
              items: { type: "string" },
              description: "开工前须具备的材料/样品/权限（整表替换）。",
            },
            actions: {
              type: "array",
              items: { type: "string" },
              description: "执行动作步骤（整表替换）。",
            },
            collaborators: {
              type: "array",
              items: { type: "string" },
              description: "协作人/评审角色（整表替换）。",
            },
            scope: {
              type: "object",
              description: "范围边界；可只传 inScope 或只传 outOfScope，未传的键保留原值。",
              properties: {
                inScope: { type: "array", items: { type: "string" } },
                outOfScope: { type: "array", items: { type: "string" } },
              },
              additionalProperties: false,
            },
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
      dependencyTaskIds: Array.isArray(patchRaw.dependencyTaskIds)
        ? normalizePatchStringList(patchRaw.dependencyTaskIds)
        : undefined,
      checkpoints: Array.isArray(patchRaw.checkpoints)
        ? normalizePatchStringList(patchRaw.checkpoints)
        : undefined,
      risks: Array.isArray(patchRaw.risks) ? normalizePatchStringList(patchRaw.risks) : undefined,
      inputMaterials: Array.isArray(patchRaw.inputMaterials)
        ? normalizePatchStringList(patchRaw.inputMaterials)
        : undefined,
      actions: Array.isArray(patchRaw.actions) ? normalizePatchStringList(patchRaw.actions) : undefined,
      collaborators: Array.isArray(patchRaw.collaborators)
        ? normalizePatchStringList(patchRaw.collaborators)
        : undefined,
      scope:
        patchRaw.scope !== null && patchRaw.scope !== undefined && typeof patchRaw.scope === "object"
        && !Array.isArray(patchRaw.scope)
          ? (patchRaw.scope as Record<string, unknown>)
          : undefined,
    };
    const hasAnyField =
      patch.title !== undefined
      || patch.objective !== undefined
      || patch.dueAt !== undefined
      || patch.assigneeUserId !== undefined
      || patch.dependencyTaskIds !== undefined
      || patch.checkpoints !== undefined
      || patch.risks !== undefined
      || patch.inputMaterials !== undefined
      || patch.actions !== undefined
      || patch.collaborators !== undefined
      || patch.scope !== undefined;
    if (!hasAnyField) {
      return {
        ok: false,
        reason: "empty_patch",
        hint:
          "patch 至少要包含 title / objective / dueAt / assigneeUserId / dependencyTaskIds / checkpoints / risks / inputMaterials / actions / collaborators / scope 之一。",
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
    if (patch.dependencyTaskIds !== undefined) {
      target.dependencyTaskIds = patch.dependencyTaskIds;
      updatedFields.push("dependencyTaskIds");
    }
    if (patch.checkpoints !== undefined) {
      const tn = (target.timeNode as Record<string, unknown> | undefined) ?? {};
      tn.checkpoints = patch.checkpoints;
      target.timeNode = tn;
      updatedFields.push("checkpoints");
    }
    if (patch.risks !== undefined) {
      target.risksAndOpenQuestions = patch.risks;
      updatedFields.push("risksAndOpenQuestions");
    }
    if (patch.inputMaterials !== undefined) {
      target.inputMaterials = patch.inputMaterials;
      updatedFields.push("inputMaterials");
    }
    if (patch.actions !== undefined) {
      target.actions = patch.actions;
      updatedFields.push("actions");
    }
    if (patch.collaborators !== undefined) {
      target.collaborators = patch.collaborators;
      updatedFields.push("collaborators");
    }
    if (patch.scope !== undefined) {
      const cur = (target.scope as Record<string, unknown> | undefined) ?? {};
      const p = patch.scope;
      const next: Record<string, unknown> = { ...cur };
      if (Object.prototype.hasOwnProperty.call(p, "inScope")) {
        next.inScope = normalizePatchStringList(p.inScope);
      }
      if (Object.prototype.hasOwnProperty.call(p, "outOfScope")) {
        next.outOfScope = normalizePatchStringList(p.outOfScope);
      }
      target.scope = next;
      updatedFields.push("scope");
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
