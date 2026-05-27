import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import {
  type PlanSession,
  startNewTaskScope,
} from "../../infra/plan-session-store";

export const NEUTRAL_START_NEW_TASK_SCOPE_LABEL = "新任务待定义";

const START_NEW_TASK_ONLY_USER_MESSAGE =
  /^(开启新任务|开新任务|新建任务|开个新任务|开始新任务|新任务)([。！!？?…\s]*)$/i;

/** 用户本条仅表达「开新任务」、尚未描述新主题（含工作台按钮文案）。 */
export function isStartNewTaskOnlyUserMessage(userMessage: string | undefined): boolean {
  const text = String(userMessage ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return START_NEW_TASK_ONLY_USER_MESSAGE.test(text);
}

export function resolveStartNewTaskScopeLabel(input: {
  modelScopeLabel: string;
  userMessage?: string;
}): { scopeLabel: string; overridden: boolean } {
  const modelScopeLabel = String(input.modelScopeLabel ?? "").trim();
  if (isStartNewTaskOnlyUserMessage(input.userMessage)) {
    return { scopeLabel: NEUTRAL_START_NEW_TASK_SCOPE_LABEL, overridden: true };
  }
  return { scopeLabel: modelScopeLabel, overridden: false };
}

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
  onSessionMutated?: (session: PlanSession) => void;
  /** 本轮 orchestrator 用户原文；仅「开启新任务」时强制中性 scopeLabel。 */
  userMessage?: string;
}

export function buildStartNewTaskHandler(
  deps: BuildStartNewTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    const modelScopeLabel = String(args.scopeLabel ?? "").trim();
    const reason = String(args.reason ?? "").trim() || undefined;
    const resolved = resolveStartNewTaskScopeLabel({
      modelScopeLabel,
      userMessage: deps.userMessage,
    });
    const scopeLabel = resolved.scopeLabel;
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
    deps.onSessionMutated?.(deps.currentSession);
    const scopeIntro = resolved.overridden
      ? `已切换到新任务「${result.toScopeLabel}」（用户尚未描述具体主题，系统使用中性标签）。`
      : `切换到新任务「${result.toScopeLabel}」。`;
    return {
      ok: true,
      fromScopeId: result.fromScopeId,
      fromScopeLabel: result.fromScopeLabel,
      fromPlanId: result.fromPlanId,
      toScopeId: result.toScopeId,
      toScopeLabel: result.toScopeLabel,
      toPlanId: result.toPlanId,
      clearedHistoryEntries: result.clearedHistoryEntries,
      scopeLabelOverridden: resolved.overridden,
      modelScopeLabel: resolved.overridden ? modelScopeLabel : undefined,
      hint:
        `已归档原任务${result.fromScopeLabel ? `「${result.fromScopeLabel}」` : ""}，` +
        `${scopeIntro}规划 id 已从 \`${result.fromPlanId}\` 更新为 \`${result.toPlanId}\`。` +
        `对话历史已清空（清除 ${result.clearedHistoryEntries} 条旧记录），candidatePool 已重置。` +
        `当前 scope 草案为空，请按用户最新输入重新生成；旧 scope 的人员名单/task_x 编号/姓名不得引用。` +
        `scope 已切换｜**本回合禁止再调任何工具**；若用户尚未描述新需求，下一条 assistant 须为纯 CLARIFY JSON（仅 message，无 draft/tasks[]）。`,
    };
  };
}
