import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import {
  type PlanSession,
  startNewTaskScope,
} from "../../infra/plan-session-store";

export const START_NEW_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "start_new_task",
    description:
      "用户明显切换到一个与当前草案/分配无关的新任务时调用。把当前会话的 latestDraft / latestAssignment / knownFacts 归档到 taskScopes，然后清空顶层进入空白的新 scope。**未确认主题已切换前不要调用**。调用后再继续 search_employees / prepare_publish_task 等工具。",
    parameters: {
      type: "object",
      properties: {
        scopeLabel: {
          type: "string",
          description: "新任务的简短标签（10-30 字），例如「无纺布来料不合格处置」。",
        },
        reason: {
          type: "string",
          description: "可选。简要写明为什么切换主题（审计字段）。",
        },
      },
      required: ["scopeLabel"],
    },
  },
};

export interface BuildStartNewTaskHandlerDeps {
  currentSession?: PlanSession;
}

export function buildStartNewTaskHandler(
  deps: BuildStartNewTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const scopeLabel = String(args.scopeLabel ?? "").trim();
    const reason = String(args.reason ?? "").trim() || undefined;
    if (!scopeLabel) {
      return {
        ok: false,
        reason: "missing_scope_label",
        hint: "scopeLabel 必填：用 10-30 字简述本轮要切到的新任务主题。",
      };
    }
    if (!deps.currentSession) {
      return {
        ok: false,
        reason: "session_unavailable",
        hint: "无可用 session，无法切换 scope（仅在 demo/单测时可能出现）。",
      };
    }
    const result = startNewTaskScope(deps.currentSession, { scopeLabel, reason });
    return {
      ok: true,
      fromScopeId: result.fromScopeId,
      fromScopeLabel: result.fromScopeLabel,
      fromPlanId: result.fromPlanId,
      toScopeId: result.toScopeId,
      toScopeLabel: result.toScopeLabel,
      toPlanId: result.toPlanId,
      clearedHistoryEntries: result.clearedHistoryEntries,
      hint:
        `已归档原任务${result.fromScopeLabel ? `「${result.fromScopeLabel}」` : ""}，` +
        `切换到新任务「${result.toScopeLabel}」。规划 id 已从 \`${result.fromPlanId}\` 更新为 \`${result.toPlanId}\`。当前 scope 草案为空，请按用户最新输入重新生成。`,
    };
  };
}
