/**
 * 主管上传花名册 → orchestrator 通过本组工具把"硬约束候选池"写入 session：
 *
 *   1. read_uploaded_roster_text({})            → 取出主管刚上传的文件原文（仅一次性）
 *   2. set_candidate_pool({ entries, unresolved? })
 *                                              → 把模型核对后的"已确定 + 待确认"名单提交进 session
 *   3. clear_candidate_pool({ reason? })        → 清空（多任务并发或主管要求重传时）
 *   4. list_candidate_pool({})                  → 回看当前池（写完不一定记得，方便模型自查）
 *
 * 设计要点：
 * - 入参里禁止裸 user 文字；entries[*].userId 必须真实存在于 dingtalk_contacts，否则该条会被丢弃
 *   并通过返回值通知模型（再交给模型反问主管）。
 * - 一次 set_candidate_pool 即覆盖整个 pool（避免半状态）；要追加请重新发一次合并后的全量。
 * - 工具不直接持久化 plan-session 文件，仅修改传入的 currentSession 引用 + 调 sessionUpdater
 *   把变更广播给上层（dingtalk-bot / workbench/api 在写盘时自然带出来）。
 */

import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type {
  CandidatePool,
  CandidatePoolEntry,
  CandidatePoolUnresolved,
  PlanSession,
} from "../../infra/plan-session-store";
import type { DingTalkContactRow } from "../../infra/people-directory-store";

export interface CandidatePoolToolDeps {
  /**
   * 当前会话引用。工具会原地写 candidatePool / pendingRosterText。
   * dingtalk-bot 与 workbench API 在 orchestrator 调用结束后会拿到同一引用并落盘。
   */
  currentSession?: PlanSession;
  /**
   * 工具修改 session 后回调，便于上层做即时持久化 / 审计。可选。
   */
  onSessionMutated?: (session: PlanSession) => void;
  /** 通过 userId 拉通讯录，用于校验 entries 是否在 dingtalk_contacts 中。 */
  getContact: (userId: string) => DingTalkContactRow | undefined;
}

export const READ_UPLOADED_ROSTER_TEXT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "read_uploaded_roster_text",
    description:
      "读取主管刚上传但尚未处理的花名册原文（md/docx/pdf 提取出的纯文本）。仅在 [memory_context] 出现 pendingRosterSource 时调用一次；调用后该文本会被消费（再调返回 ok:false / no_pending_roster）。读到后请逐一抽取姓名 → 用 search_employees(name=...) 匹配 → 然后用 set_candidate_pool 落库。",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const SET_CANDIDATE_POOL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_candidate_pool",
    description:
      "把【硬约束候选池】写入当前 plan：本 plan 之后所有指派只能从 entries[*].userId 中选。一次提交覆盖整个池。entries[*].userId 必须是 search_employees 命中的真实通讯录 ID（数字串，如 641728622）；非通讯录 ID 会被丢弃。unresolved 用于让自己/主管下一轮交互核对（写入后 search_employees 会带出来提醒）。",
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          description: "池来源标签，例如 \"uploaded:roster.md\"。可空，缺省沿用上一次。",
        },
        entries: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              userId: { type: "string", description: "通讯录真实 userId（数字串）" },
              displayName: { type: "string" },
              fileNotes: {
                type: "string",
                description: "文件中针对该员工的备注/期望职责，原文片段；可空",
              },
            },
            required: ["userId"],
          },
        },
        unresolved: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rawName: { type: "string" },
              hint: { type: "string" },
            },
            required: ["rawName"],
          },
        },
      },
      required: ["entries"],
    },
  },
};

export const CLEAR_CANDIDATE_POOL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "clear_candidate_pool",
    description:
      "清空当前 plan 的候选池。当主管说【重新上传一份】或【不用名单了，按全员选】时调用。调用后 search_employees 恢复全通讯录范围。",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: [],
    },
  },
};

export const LIST_CANDIDATE_POOL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "list_candidate_pool",
    description:
      "返回当前 plan 的候选池快照（已落库的 entries + 未解析的 unresolved）。写指派前如果不确定池里有哪些 userId，调本工具自查，不要凭记忆。",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export function buildReadUploadedRosterTextHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return () => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }
    const text = String(session.pendingRosterText ?? "").trim();
    if (!text) {
      return { ok: false, reason: "no_pending_roster" };
    }
    const sourceLabel = session.pendingRosterSource ?? "uploaded:roster";
    // 一次性消费：避免模型在多轮里反复读到同一段，也避免落盘后重启又被重新触发。
    session.pendingRosterText = undefined;
    session.pendingRosterSource = undefined;
    deps.onSessionMutated?.(session);
    return {
      ok: true,
      sourceLabel,
      chars: text.length,
      text,
    };
  };
}

export function buildSetCandidatePoolHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return (args) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }
    const rawEntries = Array.isArray(args.entries) ? (args.entries as unknown[]) : [];
    const accepted: CandidatePoolEntry[] = [];
    const rejected: Array<{ userId: string; reason: string }> = [];
    const seen = new Set<string>();

    for (const raw of rawEntries) {
      if (!raw || typeof raw !== "object") continue;
      const obj = raw as Record<string, unknown>;
      const userId = String(obj.userId ?? "").trim();
      if (!userId) {
        rejected.push({ userId: "", reason: "missing_userId" });
        continue;
      }
      if (seen.has(userId)) continue;
      seen.add(userId);
      const contact = deps.getContact(userId);
      if (!contact) {
        rejected.push({ userId, reason: "not_in_dingtalk_contacts" });
        continue;
      }
      if (!contact.active) {
        rejected.push({ userId, reason: "contact_inactive" });
        continue;
      }
      const displayName =
        String(obj.displayName ?? "").trim() || contact.name || userId;
      const fileNotesRaw = String(obj.fileNotes ?? "").trim();
      const entry: CandidatePoolEntry = { userId, displayName };
      if (fileNotesRaw) entry.fileNotes = fileNotesRaw.slice(0, 400);
      accepted.push(entry);
    }

    if (accepted.length === 0) {
      return {
        ok: false,
        reason: "all_entries_rejected",
        rejected,
        hint: "全部条目都不在通讯录或被标记为 inactive；请重新核对姓名后再调用，或先 search_employees(name=…)。",
      };
    }

    const unresolvedInput = Array.isArray(args.unresolved) ? args.unresolved : [];
    const unresolved: CandidatePoolUnresolved[] = [];
    for (const item of unresolvedInput as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const rawName = String(obj.rawName ?? "").trim();
      if (!rawName) continue;
      const hint = String(obj.hint ?? "").trim();
      const entry: CandidatePoolUnresolved = { rawName: rawName.slice(0, 80) };
      if (hint) entry.hint = hint.slice(0, 200);
      unresolved.push(entry);
    }

    const previous = session.candidatePool;
    const sourceArg = String(args.source ?? "").trim();
    const source = sourceArg || previous?.source || "manual:set_candidate_pool";

    const next: CandidatePool = {
      source,
      entries: accepted,
      updatedAt: new Date().toISOString(),
    };
    if (unresolved.length > 0) next.unresolved = unresolved;

    session.candidatePool = next;
    deps.onSessionMutated?.(session);

    return {
      ok: true,
      pool: {
        source: next.source,
        entriesCount: next.entries.length,
        unresolvedCount: next.unresolved?.length ?? 0,
        updatedAt: next.updatedAt,
        entries: next.entries.map((e) => ({
          userId: e.userId,
          displayName: e.displayName,
        })),
      },
      rejected,
    };
  };
}

export function buildClearCandidatePoolHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return (args) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }
    if (!session.candidatePool) {
      return { ok: true, alreadyEmpty: true };
    }
    const reason = String(args.reason ?? "").trim() || "cleared_by_agent";
    const previous = session.candidatePool;
    session.candidatePool = undefined;
    deps.onSessionMutated?.(session);
    return {
      ok: true,
      cleared: true,
      reason,
      previousSource: previous.source,
      previousEntriesCount: previous.entries.length,
    };
  };
}

export function buildListCandidatePoolHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return () => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }
    const pool = session.candidatePool;
    if (!pool) {
      return { ok: true, hasPool: false };
    }
    return {
      ok: true,
      hasPool: true,
      pool: {
        source: pool.source,
        updatedAt: pool.updatedAt,
        entries: pool.entries.map((e) => ({
          userId: e.userId,
          displayName: e.displayName,
          fileNotes: e.fileNotes ?? undefined,
        })),
        unresolved: pool.unresolved ?? [],
      },
    };
  };
}
