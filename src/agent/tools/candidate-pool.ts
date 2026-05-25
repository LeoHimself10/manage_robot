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
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { recordSearchHitsFromCandidates } from "../employee-search-cache";

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
      "读取主管刚上传但尚未处理的花名册原文（md/docx/pdf 提取出的纯文本）。仅在 [memory_context] 出现 pendingRosterSource 时调用一次；调用后该文本会被消费（再调返回 ok:false / no_pending_roster）。读到后请抽取全部姓名 → **一次**调用 resolve_roster_names({ names: [...] }) → 再用 set_candidate_pool 落库；**禁止**对每个姓名单独 search_employees(name=...)。除姓名外须从原文提取每人「部门/岗位/技能标签/职责」片段，写入 set_candidate_pool 的 entries[*].fileNotes。",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

export const RESOLVE_ROSTER_NAMES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "resolve_roster_names",
    description:
      "批量将名单中的姓名解析为通讯录 userId（一次最多 30 人，**不计入** search_employees 的 3 次 quota）。read_uploaded_roster_text 之后调用；结果用于 set_candidate_pool.entries。同名多人且无法唯一确定时写入 unresolved。",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 30,
          description: "从花名册/用户消息抽取的姓名列表（去重后提交）。",
        },
      },
      required: ["names"],
    },
  },
};

const ROSTER_RESOLVE_MAX_NAMES = 30;

export interface RosterNameResolveMatch {
  inputName: string;
  userId: string;
  displayName: string;
  department?: string;
}

export interface RosterNameResolveUnresolved {
  rawName: string;
  hint: string;
}

export interface ResolveRosterNamesResult {
  ok: true;
  resolved: RosterNameResolveMatch[];
  unresolved: RosterNameResolveUnresolved[];
  duplicateSkipped: number;
}

/** Pure resolver for tests — picks unique exact name match, else single SQL hit, else unresolved. */
export function resolveRosterNamesFromContacts(
  rawNames: string[],
  searchContacts: (keyword: string, limit?: number) => DingTalkContactRow[],
): ResolveRosterNamesResult {
  const seenInputs = new Set<string>();
  const resolved: RosterNameResolveMatch[] = [];
  const unresolved: RosterNameResolveUnresolved[] = [];
  let duplicateSkipped = 0;

  for (const raw of rawNames) {
    const inputName = String(raw ?? "").trim();
    if (!inputName) continue;
    const key = inputName.toLowerCase();
    if (seenInputs.has(key)) {
      duplicateSkipped += 1;
      continue;
    }
    seenInputs.add(key);

    const hits = searchContacts(inputName, 8).filter((c) => c.active !== false);
    if (hits.length === 0) {
      unresolved.push({
        rawName: inputName,
        hint: `通讯录未找到「${inputName}」；请确认全名或请主管补充。`,
      });
      continue;
    }

    const exact = hits.filter(
      (c) => String(c.name ?? "").trim().toLowerCase() === key,
    );
    const pick = exact.length === 1 ? exact[0] : hits.length === 1 ? hits[0] : undefined;

    if (!pick) {
      const sample = hits
        .slice(0, 3)
        .map((c) => c.name || c.userId)
        .join("、");
      unresolved.push({
        rawName: inputName,
        hint:
          exact.length > 1
            ? `「${inputName}」存在 ${exact.length} 个同名，请提供更全姓名或部门。`
            : `「${inputName}」匹配到多人（如 ${sample}），请缩小范围。`,
      });
      continue;
    }

    resolved.push({
      inputName,
      userId: pick.userId,
      displayName: String(pick.name ?? pick.userId).trim(),
      department: pick.departmentNames?.[0],
    });
  }

  return { ok: true, resolved, unresolved, duplicateSkipped };
}

export function buildResolveRosterNamesHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return (args) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }
    const rawNames = Array.isArray(args.names) ? (args.names as unknown[]) : [];
    const names = rawNames
      .map((n) => String(n ?? "").trim())
      .filter(Boolean)
      .slice(0, ROSTER_RESOLVE_MAX_NAMES);
    if (names.length === 0) {
      return { ok: false, reason: "empty_names", hint: "names 至少 1 个非空姓名。" };
    }

    const store = createPeopleDirectoryStore();
    try {
      const result = resolveRosterNamesFromContacts(names, (keyword, limit) =>
        store.searchContacts(keyword, limit ?? 8),
      );

      if (result.resolved.length > 0) {
        const blocks = result.resolved.map(
          (r) => `userId: ${r.userId}\ndisplayName: ${r.displayName}`,
        );
        recordSearchHitsFromCandidates(session, blocks, (userId) => {
          const c = deps.getContact(userId);
          return c ? { name: c.name, departmentNames: c.departmentNames } : undefined;
        });
        deps.onSessionMutated?.(session);
      }

      return result;
    } finally {
      store.close();
    }
  };
}

export const SET_CANDIDATE_POOL_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "set_candidate_pool",
    description:
      "把【硬约束候选池】写入当前 plan：本 plan 之后所有指派只能从 entries[*].userId 中选。一次提交覆盖整个池。entries[*].userId 须来自 resolve_roster_names 或 search_employees 命中的真实通讯录 ID（数字串）；非通讯录 ID 会被丢弃。entries[*].fileNotes **应**写入花名册原文中该员工的部门/岗位/技能/职责摘要（≤400 字）；来源为上传花名册时 ASSIGN 将**优先**用 fileNotes 做技能匹配。unresolved 用于让自己/主管下一轮交互核对（写入后 search_employees 会带出来提醒）。",
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
        hint: "全部条目都不在通讯录或被标记为 inactive；请重新核对姓名后再提交，或先用「按姓名查找通讯录」定位到真实人员后再落池。",
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
