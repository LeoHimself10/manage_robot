/**
 * Atomic roster-assign tool (v2-only).
 *
 * Bundles the mechanical roster-prep chain (read pending roster text → parse
 * name sections → resolve names against contacts → build candidate pool with
 * fileNotes) with the final whole-table assignment write. The model keeps the
 * judgment call — who gets which task — while the deterministic prep is done
 * in code, so the tool is safe to force at any point of the turn (no
 * "pool not built yet" ordering hazard).
 */
import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import type {
  CandidatePoolEntry,
  CandidatePoolUnresolved,
  PlanSession,
} from "../../infra/plan-session-store";
import type { DingTalkContactRow } from "../../infra/people-directory-store";
import { resolveRosterNamesFromContacts } from "../tools/candidate-pool";
import { buildBulkAssignTasksHandler } from "../tools/bulk-assign-tasks";
import { logStructured } from "../../infra/logger";

export const ASSIGN_FROM_ROSTER_TOOL_NAME = "assign_from_roster";

export const ASSIGN_FROM_ROSTER_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: ASSIGN_FROM_ROSTER_TOOL_NAME,
    description:
      "【花名册整表指派首选·原子工具】一次完成：若候选池未建且有刚上传的花名册，先自动建池"
      + "（机械解析姓名 + 部门/技能 fileNotes，等价 read_uploaded_roster_text → resolve_roster_names → set_candidate_pool）；"
      + "再把 assignments 中的姓名解析为池内 userId，整表写入负责人（等价 bulk_assign_tasks，须覆盖全部 draft taskId）。"
      + "谁负责哪条由你按技能匹配判断；读名册/解析/建池由本工具代劳，调用本工具前**不要**再单独调"
      + " read_uploaded_roster_text / resolve_roster_names / set_candidate_pool。",
    parameters: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              taskId: { type: "string", description: "draft.tasks[].id" },
              assigneeName: {
                type: "string",
                description: "花名册 / 候选池中的姓名（推荐用姓名，工具会解析为 userId）",
              },
              assigneeUserId: {
                type: "string",
                description: "可选；已确定池内 userId 时可直接给，优先于 assigneeName",
              },
              collaborators: {
                type: "array",
                items: { type: "string" },
                description: "协作人 displayName（可选）",
              },
            },
            required: ["taskId"],
          },
        },
        source: {
          type: "string",
          description: "建池时的来源标签；缺省沿用上传文件名或 uploaded:roster",
        },
      },
      required: ["assignments"],
    },
  },
};

/** `## 姓名` style heading: 2–4 CJK chars and nothing else. */
const NAME_HEADING_RE = /^#{2,4}\s*([\u4e00-\u9fa5]{2,4})\s*$/;
/** Generic section words that look like 2–4 CJK headings but are not names. */
const NON_NAME_HEADING_RE =
  /提示|说明|背景|框架|分工|建议|附录|目标|总结|备注|名单|要求|流程|注意|概述|简介/;
const ANY_HEADING_RE = /^#{1,4}\s/;
const TABLE_SEPARATOR_RE = /^\|?\s*[-:|\s]+\|?$/;

export interface RosterSection {
  name: string;
  fileNotes: string;
}

function compactRosterBody(lines: string[]): string {
  const parts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === "---") continue;
    if (TABLE_SEPARATOR_RE.test(line) && line.includes("-")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length === 0) continue;
    // skip "| 项目 | 说明 |" style header rows
    if (cells.length === 2 && cells[0] === "项目" && cells[1] === "说明") continue;
    parts.push(cells.join(": "));
  }
  return parts.join("；").slice(0, 400);
}

/**
 * Mechanical markdown roster parser: each `## 姓名` heading starts a person
 * section; the section body (until the next heading) becomes fileNotes.
 * Non-name headings (e.g. `## 使用提示`) end the current section.
 */
export function parseRosterSections(text: string): RosterSection[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const sections: Array<{ name: string; bodyLines: string[] }> = [];
  let current: { name: string; bodyLines: string[] } | undefined;
  for (const raw of lines) {
    const line = raw.trim();
    const nameMatch = NAME_HEADING_RE.exec(line);
    if (nameMatch && !NON_NAME_HEADING_RE.test(nameMatch[1])) {
      current = { name: nameMatch[1], bodyLines: [] };
      sections.push(current);
      continue;
    }
    if (ANY_HEADING_RE.test(line)) {
      current = undefined;
      continue;
    }
    if (current) current.bodyLines.push(raw);
  }
  return sections.map((s) => ({ name: s.name, fileNotes: compactRosterBody(s.bodyLines) }));
}

export interface AssignFromRosterToolDeps {
  currentSession?: PlanSession;
  onSessionMutated?: (session: PlanSession) => void;
  getContact: (userId: string) => DingTalkContactRow | undefined;
  searchContacts: (keyword: string, limit?: number) => DingTalkContactRow[];
}

export function buildAssignFromRosterHandler(deps: AssignFromRosterToolDeps): ToolHandler {
  const bulkHandler = buildBulkAssignTasksHandler({
    currentSession: deps.currentSession,
    getContact: deps.getContact,
  });

  return (args: Record<string, unknown>) => {
    const session = deps.currentSession;
    if (!session) return { ok: false, reason: "no_session" };

    const rowsIn = Array.isArray(args.assignments) ? (args.assignments as unknown[]) : [];
    if (rowsIn.length === 0) {
      return {
        ok: false,
        reason: "missing_assignments",
        hint: "assignments 须为非空数组，且覆盖全部 draft taskId。",
      };
    }

    // Step 1: ensure candidate pool (mechanical roster prep, only if absent).
    let poolBuilt = false;
    let poolBuildInfo: Record<string, unknown> | undefined;
    const hasPool = (session.candidatePool?.entries?.length ?? 0) > 0;
    if (!hasPool) {
      const rosterText = String(session.pendingRosterText ?? "").trim();
      if (!rosterText) {
        return {
          ok: false,
          reason: "no_roster_or_pool",
          hint: "当前既无候选池也无待处理花名册；请改用 search_employees 确认人选后 bulk_assign_tasks。",
        };
      }

      const sections = parseRosterSections(rosterText);
      const namesFromRoster = sections.map((s) => s.name);
      const namesFromArgs = rowsIn
        .map((item) => String((item as Record<string, unknown>)?.assigneeName ?? "").trim())
        .filter(Boolean);
      const names = namesFromRoster.length > 0 ? namesFromRoster : [...new Set(namesFromArgs)];
      if (names.length === 0) {
        return {
          ok: false,
          reason: "roster_unparsable",
          hint: "花名册原文中未解析到姓名段落，assignments 里也没有 assigneeName；请先人工核对名单。",
        };
      }

      const resolved = resolveRosterNamesFromContacts(names, (keyword, limit) =>
        deps.searchContacts(keyword, limit ?? 8),
      );
      const notesByName = new Map(sections.map((s) => [s.name, s.fileNotes]));
      const entries: CandidatePoolEntry[] = resolved.resolved.map((r) => {
        const entry: CandidatePoolEntry = { userId: r.userId, displayName: r.displayName };
        const notes = notesByName.get(r.inputName);
        if (notes) entry.fileNotes = notes.slice(0, 400);
        return entry;
      });
      if (entries.length === 0) {
        return {
          ok: false,
          reason: "roster_names_unresolved",
          unresolved: resolved.unresolved,
          hint: "花名册中的姓名都无法在通讯录唯一解析；请核对全名后重试。",
        };
      }

      const unresolved: CandidatePoolUnresolved[] = resolved.unresolved.map((u) => ({
        rawName: u.rawName.slice(0, 80),
        hint: u.hint.slice(0, 200),
      }));
      const sourceLabel =
        String(args.source ?? "").trim() || session.pendingRosterSource || "uploaded:roster";
      session.candidatePool = {
        source: sourceLabel,
        entries,
        updatedAt: new Date().toISOString(),
        ...(unresolved.length > 0 ? { unresolved } : {}),
      };
      // 一次性消费，与 read_uploaded_roster_text 同语义。
      session.pendingRosterText = undefined;
      session.pendingRosterSource = undefined;
      poolBuilt = true;
      poolBuildInfo = {
        source: sourceLabel,
        entriesCount: entries.length,
        unresolvedCount: unresolved.length,
        entries: entries.map((e) => ({ userId: e.userId, displayName: e.displayName })),
      };
      // NOTE: do NOT call onSessionMutated here. The upstream callback may
      // rebind its session to a spread copy, and the assignment write below
      // (in-place on this reference) would then be lost. Broadcast once at
      // the end, after all mutations.
    }

    // Step 2: resolve assignee names against the pool.
    const pool = session.candidatePool?.entries ?? [];
    const unknownNames: string[] = [];
    const resolvedRows: Array<Record<string, unknown>> = [];
    for (const item of rowsIn) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const taskId = String(row.taskId ?? "").trim();
      let userId = String(row.assigneeUserId ?? "").trim();
      const name = String(row.assigneeName ?? "").trim();
      if (!userId && name) {
        const exact = pool.filter((e) => e.displayName === name);
        const matched =
          exact.length > 0
            ? exact
            : pool.filter(
                (e) => e.displayName.includes(name) || name.includes(e.displayName),
              );
        if (matched.length === 1) {
          userId = matched[0].userId;
        } else {
          unknownNames.push(name);
          continue;
        }
      }
      if (!taskId || !userId) continue;
      resolvedRows.push({
        taskId,
        assigneeUserId: userId,
        ...(Array.isArray(row.collaborators) ? { collaborators: row.collaborators } : {}),
      });
    }

    if (unknownNames.length > 0) {
      if (poolBuilt) deps.onSessionMutated?.(session);
      return {
        ok: false,
        reason: "unknown_assignee_names",
        unknownNames: [...new Set(unknownNames)],
        poolBuilt,
        poolNames: pool.map((e) => e.displayName),
        hint: `这些姓名不在候选池或无法唯一匹配：${[...new Set(unknownNames)].join("、")}；池内可选：${pool
          .map((e) => e.displayName)
          .join("、")}。`,
      };
    }

    // Step 3: whole-table write via the existing bulk-assign logic
    // (full-coverage / pool-membership / contact-active checks all inherited).
    const bulkResult = bulkHandler({ assignments: resolvedRows }) as Record<string, unknown>;
    if (poolBuilt || bulkResult.ok === true) deps.onSessionMutated?.(session);
    logStructured({
      event: "assign_from_roster_result",
      ok: bulkResult.ok === true,
      reason: bulkResult.reason,
      poolBuilt,
      rowsIn: rowsIn.length,
      rowsResolved: resolvedRows.length,
      taskIds: resolvedRows.map((r) => r.taskId),
    });
    return {
      ...bulkResult,
      poolBuilt,
      ...(poolBuildInfo ? { poolBuild: poolBuildInfo } : {}),
    };
  };
}
