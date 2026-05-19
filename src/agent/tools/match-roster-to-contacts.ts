/**
 * 花名册姓名 → 通讯录批量匹配（不占 search_employees 配额）。
 */

import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { extractNamesFromRosterText } from "../assignment/roster-parser";
import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import type {
  CandidatePool,
  CandidatePoolEntry,
  CandidatePoolUnresolved,
} from "../../infra/plan-session-store";
import type { CandidatePoolToolDeps } from "./candidate-pool";

export const MATCH_ROSTER_TO_CONTACTS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "match_roster_to_contacts",
    description:
      "把花名册中的姓名批量匹配到钉钉通讯录（一次调用处理多人，不占 search_employees 配额）。可传 names[]，或 fromPendingRoster=true 从 session 待处理花名册抽取姓名。默认 applyCandidatePool=true 将命中人员写入候选池。匹配后请用 set_candidate_pool 仅当需要覆盖/补充 unresolved 时；多数场景本工具已写池。",
    parameters: {
      type: "object",
      properties: {
        names: {
          type: "array",
          items: { type: "string" },
          description: "待匹配的姓名列表（与 fromPendingRoster 可组合，会去重合并）",
        },
        fromPendingRoster: {
          type: "boolean",
          description:
            "true 时从 session.pendingRosterText 用 ## 标题抽取姓名；处理完成后清除 pending（与 read_uploaded_roster_text 消费语义一致）",
        },
        applyCandidatePool: {
          type: "boolean",
          description: "是否将 matched 写入 session.candidatePool，默认 true",
        },
      },
      required: [],
    },
  },
};

export interface RosterMatchCandidate {
  userId: string;
  displayName: string;
}

export interface RosterMatchedRow {
  inputName: string;
  userId: string;
  displayName: string;
}

export interface RosterUnresolvedRow {
  inputName: string;
  reason: "not_found" | "ambiguous";
  candidates?: RosterMatchCandidate[];
  hint?: string;
}

function collectNames(
  args: Record<string, unknown>,
  session: CandidatePoolToolDeps["currentSession"],
): { names: string[]; consumedPending: boolean; pendingSource?: string } {
  const fromPending = args.fromPendingRoster === true;
  const explicit = Array.isArray(args.names)
    ? (args.names as unknown[]).map((n) => String(n ?? "").trim()).filter(Boolean)
    : [];

  const merged: string[] = [...explicit];
  const seen = new Set(merged);
  let consumedPending = false;
  let pendingSource: string | undefined;

  if (fromPending && session) {
    const pendingText = String(session.pendingRosterText ?? "").trim();
    if (pendingText) {
      pendingSource = session.pendingRosterSource ?? "uploaded:roster";
      for (const n of extractNamesFromRosterText(pendingText)) {
        if (!seen.has(n)) {
          seen.add(n);
          merged.push(n);
        }
      }
      consumedPending = true;
    }
  }

  return { names: merged, consumedPending, pendingSource };
}

function matchOneName(name: string): RosterMatchedRow | RosterUnresolvedRow {
  const store = createPeopleDirectoryStore();
  try {
    const hits = store.searchContacts(name, 5).filter((c) => c.active);
    if (hits.length === 0) {
      return {
        inputName: name,
        reason: "not_found",
        hint: `通讯录未找到「${name}」，请确认姓名或请主管核对花名册用字`,
      };
    }
    if (hits.length === 1) {
      const c = hits[0]!;
      const displayName = c.name || name;
      return {
        inputName: name,
        userId: c.userId,
        displayName,
      };
    }
    return {
      inputName: name,
      reason: "ambiguous",
      candidates: hits.slice(0, 5).map((c) => ({
        userId: c.userId,
        displayName: c.name || c.userId,
      })),
      hint: `「${name}」匹配到 ${hits.length} 人，请主管点名或缩小范围`,
    };
  } finally {
    store.close();
  }
}

function applyPoolFromMatch(
  deps: CandidatePoolToolDeps,
  matched: RosterMatchedRow[],
  unresolved: RosterUnresolvedRow[],
  source: string,
): { ok: true; entriesCount: number } | { ok: false; reason: string } {
  const session = deps.currentSession;
  if (!session) {
    return { ok: false, reason: "no_session" };
  }

  const accepted: CandidatePoolEntry[] = [];
  const rejected: Array<{ userId: string; reason: string }> = [];
  const seen = new Set<string>();

  for (const row of matched) {
    const userId = row.userId;
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
    accepted.push({
      userId,
      displayName: row.displayName || contact.name || userId,
    });
  }

  if (accepted.length === 0) {
    return { ok: false, reason: "all_entries_rejected" };
  }

  const unresolvedEntries: CandidatePoolUnresolved[] = unresolved.map((u) => {
    const entry: CandidatePoolUnresolved = {
      rawName: u.inputName.slice(0, 80),
    };
    const hint = u.hint ?? (u.reason === "ambiguous" ? "ambiguous_match" : "not_found");
    entry.hint = hint.slice(0, 200);
    return entry;
  });

  const next: CandidatePool = {
    source,
    entries: accepted,
    updatedAt: new Date().toISOString(),
  };
  if (unresolvedEntries.length > 0) next.unresolved = unresolvedEntries;

  session.candidatePool = next;
  deps.onSessionMutated?.(session);
  return { ok: true, entriesCount: accepted.length };
}

export function buildMatchRosterToContactsHandler(deps: CandidatePoolToolDeps): ToolHandler {
  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) {
      return { ok: false, reason: "no_session" };
    }

    const { names, consumedPending, pendingSource } = collectNames(args, session);
    if (names.length === 0) {
      return {
        ok: false,
        reason: "no_names",
        hint: "请传 names[] 或 fromPendingRoster=true 且 session 有待处理花名册",
      };
    }

    const matched: RosterMatchedRow[] = [];
    const unresolved: RosterUnresolvedRow[] = [];

    for (const name of names) {
      const result = matchOneName(name);
      if ("userId" in result) {
        matched.push(result);
      } else {
        unresolved.push(result);
      }
    }

    const applyPool = args.applyCandidatePool !== false;
    const source =
      pendingSource ?? (String(args.source ?? "").trim() || "match_roster_to_contacts");
    let candidatePoolApplied = false;
    let poolWarning: string | undefined;

    if (applyPool && matched.length > 0) {
      const poolResult = applyPoolFromMatch(deps, matched, unresolved, source);
      if (poolResult.ok) {
        candidatePoolApplied = true;
      } else {
        poolWarning = poolResult.reason;
      }
    }

    if (consumedPending) {
      session.pendingRosterText = undefined;
      session.pendingRosterSource = undefined;
      deps.onSessionMutated?.(session);
    }

    return {
      ok: true,
      matched,
      unresolved,
      stats: {
        totalNames: names.length,
        matchedCount: matched.length,
        unresolvedCount: unresolved.length,
      },
      candidatePoolApplied,
      poolWarning,
      hint:
        matched.length > 0
          ? "已批量匹配；指派请从 candidatePool.entries 选 userId，勿对花名册每人 search_employees"
          : "全部未唯一命中，请根据 unresolved 请主管消歧或修正花名册用字",
    };
  };
}
