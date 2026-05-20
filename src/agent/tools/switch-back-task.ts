import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import {
  type PlanSession,
  restoreTaskScope,
} from "../../infra/plan-session-store";

export const SWITCH_BACK_TASK_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "switch_back_task",
    description:
      "把当前会话切回某个已归档的 taskScope（例如用户说「回到刚才那个无纺布的草案」）。可用 scopeId 精确匹配，或用 scopeLabelKeyword 模糊匹配 scopeLabel。归档候选可通过 list_known_facts 看不到——若不确定有没有归档主题，先调用本工具且不传参数，会返回 candidates 列表。",
    parameters: {
      type: "object",
      properties: {
        scopeId: {
          type: "string",
          description: "精确 scopeId（形如 scope:abcdef12）。",
        },
        scopeLabelKeyword: {
          type: "string",
          description: "scopeLabel 关键词，做 case-insensitive 子串匹配（例如「无纺布」）。",
        },
        reason: {
          type: "string",
          description: "可选。简要说明为什么切回（审计字段）。",
        },
      },
    },
  },
};

export interface BuildSwitchBackTaskHandlerDeps {
  currentSession?: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
}

export function buildSwitchBackTaskHandler(
  deps: BuildSwitchBackTaskHandlerDeps = {},
): ToolHandler {
  return (args: Record<string, unknown>) => {
    if (!deps.currentSession) {
      return {
        ok: false,
        reason: "session_unavailable",
        hint: "无可用 session（仅在 demo/单测时可能出现）。",
      };
    }
    const scopeId = String(args.scopeId ?? "").trim() || undefined;
    const scopeLabelKeyword = String(args.scopeLabelKeyword ?? "").trim() || undefined;
    const reason = String(args.reason ?? "").trim() || undefined;
    const result = restoreTaskScope(deps.currentSession, {
      scopeId,
      scopeLabelKeyword,
      reason,
    });
    if (!result.ok) {
      const candidatesHint = result.candidates.length === 0
        ? "当前会话还没有归档过其他任务，无 scope 可切回。"
        : `可切回的归档任务：${result.candidates
            .map((c) => `${c.scopeId}(${c.scopeLabel}${c.hasDraft ? ",有草案" : ",无草案"})`)
            .join("；")}`;
      const reasonHint = result.reason === "missing_query"
        ? "请提供 scopeId 或 scopeLabelKeyword 之一。"
        : result.reason === "no_archived_scopes"
          ? "当前会话尚未通过 start_new_task 归档过任务，无 scope 可切回。"
          : "未找到匹配的归档 scope。";
      return {
        ok: false,
        reason: result.reason,
        candidates: result.candidates,
        hint: `${reasonHint} ${candidatesHint}`,
      };
    }
    deps.onSessionMutated?.(deps.currentSession);
    return {
      ok: true,
      fromScopeId: result.fromScopeId,
      toScopeId: result.toScopeId,
      toScopeLabel: result.toScopeLabel,
      toPlanId: result.toPlanId,
      hasDraft: result.hasDraft,
      clearedHistoryEntries: result.clearedHistoryEntries,
      hint:
        `已切回任务「${result.toScopeLabel}」，当前规划 id 为 \`${result.toPlanId}\`。` +
        `${result.hasDraft ? "原草案已恢复到当前会话，可基于它继续讨论或发布。" : "该 scope 之前没有保存过草案，需要重新拆解。"}` +
        `对话历史已清空（清除 ${result.clearedHistoryEntries} 条旧记录），旧 candidatePool 已重置；如需复用名单请重新上传或主管手动重选。` +
        `scope 已切换｜**本回合禁止再调任何工具**；若需确认用户意图，下一条 assistant 须为纯 CLARIFY JSON（无 draft/tasks[]）。`,
    };
  };
}
