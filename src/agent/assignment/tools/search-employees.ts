import type { ToolDefinition, ToolHandler } from "../../demo/qwen-compatible-client";
import type { EmployeeProfileRecord } from "../../../integrations/repos/employee-profile-repo";
import { createPeopleDirectoryStore, type DingTalkContactRow } from "../../../infra/people-directory-store";

export interface SearchEmployeesArgs {
  /** SQL LIKE lookup on dingtalk_contacts.name / user_id; bypasses cap when set. */
  name?: string;
  domain?: string;
  skills?: string[];
  department?: string;
  role?: string;
}

export interface SearchEmployeesResult {
  candidates: string[];
  truncated: boolean;
  total: number;
  note?: string;
  /** 当本次结果由"主管上传花名册产生的候选池"硬约束过滤时为 true。 */
  poolConstrained?: boolean;
}

export interface SearchEmployeesHandlerContext {
  /** Current actor (e.g. DingTalk sender) for local-department boost */
  actorUserId?: string;
  /**
   * 主管已上传花名册并由 agent 落库的候选池。提供时：
   *  - 无 name 参数的列举 → 只返回池内成员
   *  - name 参数 → 仅在池内做 displayName / userId 模糊匹配
   * （目的：硬约束本 plan 只能在主管圈定的人里挑。）
   */
  candidatePool?: () => Array<{ userId: string; displayName: string; fileNotes?: string }>;
}

const MAX_LOCAL_FIRST = 15;
const MIN_CROSS_DEPT_SLOTS = 10;

function maxCandidatesCap(): number {
  const raw = Number(String(process.env.SEARCH_EMPLOYEES_MAX_CANDIDATES ?? "25").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.min(500, Math.floor(raw)) : 25;
}

function searchEmployeesPerOrchestratorQuota(): number {
  const raw = Number(String(process.env.SEARCH_EMPLOYEES_PER_ORCHESTRATOR_QUOTA ?? "3").trim());
  return Number.isFinite(raw) && raw > 0 ? Math.max(1, Math.floor(raw)) : 3;
}

function truncateText(s: string, max: number): string {
  const t = String(s ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Full profile block for get_employee_details / name lookup */
export function compressProfileFull(p: EmployeeProfileRecord): string {
  const lines: string[] = [];

  lines.push(`userId: ${p.userId}`);
  lines.push(`displayName: ${p.displayName}`);
  lines.push(`department: ${p.department}`);
  if (p.departmentNames?.length) {
    lines.push(`departmentNames: [${p.departmentNames.join(", ")}]`);
  }
  lines.push(`role: ${p.role}`);
  if (p.level) lines.push(`level: ${p.level}`);

  const tags = p.selfProfile.skillTags;
  if (tags.length > 0) lines.push(`skillTags: [${tags.join(", ")}]`);

  const strengths = p.selfProfile.strengths;
  if (strengths.length > 0) lines.push(`strengths: [${strengths.join(", ")}]`);

  const boundaries = p.selfProfile.boundaries;
  if (boundaries.length > 0) lines.push(`boundaries: [${boundaries.join(", ")}]`);

  const bg = p.selfProfile.background?.trim();
  if (bg) lines.push(`background: ${truncateText(bg, 800)}`);

  const cases = p.selfProfile.cases;
  if (cases.length > 0) {
    const caseLines = cases.map((c) => {
      const contrib = c.contribution ? truncateText(c.contribution, 120) : "";
      const deliv = c.deliverable ? truncateText(c.deliverable, 120) : "";
      return `  - taskType=${c.taskType}, outcome=${c.outcome}${contrib ? `, contribution=${contrib}` : ""}${deliv ? `, deliverable=${deliv}` : ""}`;
    });
    lines.push(`cases:\n${caseLines.join("\n")}`);
  }

  const tools = p.selfProfile.tools;
  if (tools.length > 0) lines.push(`tools: [${tools.join(", ")}]`);

  const avail = p.selfProfile.availability;
  if (avail.capacityHint) lines.push(`capacityHint: ${avail.capacityHint}`);
  if (avail.emergencyOk !== undefined) lines.push(`emergencyOk: ${avail.emergencyOk}`);
  if (avail.rejectedTaskTypes && avail.rejectedTaskTypes.length > 0) {
    lines.push(`rejectedTaskTypes: [${avail.rejectedTaskTypes.join(", ")}]`);
  }
  if (p.taskHistory) {
    lines.push(
      `taskHistory: assigned=${p.taskHistory.totalAssigned}, done=${p.taskHistory.doneCount}, blocked=${p.taskHistory.blockedCount}, rejected=${p.taskHistory.rejectedCount}, accepted=${p.taskHistory.acceptedCount}, inProgress=${p.taskHistory.inProgressCount}`,
    );
  }

  return lines.join("\n");
}

/** Compact one block for first-pass search_employees (§5.6) */
export function compressProfileBrief(p: EmployeeProfileRecord, local: boolean): string {
  const tags = (p.selfProfile.skillTags ?? []).slice(0, 5);
  const cases = p.selfProfile.cases ?? [];
  const last = cases.length > 0 ? cases[cases.length - 1] : undefined;
  const lastSummary = last
    ? `${last.taskType}, ${truncateText(last.outcome, 20)}`
    : "—";
  const th = p.taskHistory;
  const hist = th
    ? `done${th.doneCount}/inProg${th.inProgressCount}/blocked${th.blockedCount}/rej${th.rejectedCount}`
    : "done0/inProg0/blocked0/rej0";
  const cap = p.selfProfile.availability?.capacityHint ?? "";
  const emerg =
    p.selfProfile.availability?.emergencyOk === true
      ? "emergencyOk=true"
      : p.selfProfile.availability?.emergencyOk === false
        ? "emergencyOk=false"
        : "";
  const lines = [
    `id=${p.userId} | name=${p.displayName}`,
    `dept=${p.department} | role=${p.role}${p.level ? ` | level=${p.level}` : ""}`,
    `tags=[${tags.join(", ")}]`,
    `cases=${cases.length} (${lastSummary})`,
    `hist=${hist}`,
    cap ? `cap=${truncateText(cap, 40)}` : emerg,
    `local=${local ? "true" : "false"}`,
  ].filter(Boolean);
  return lines.join("\n");
}

/** @deprecated Use compressProfileFull; kept for tests and external imports */
export const compressProfile = compressProfileFull;

export const SEARCH_EMPLOYEES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_employees",
    description:
      "列出在职员工作为任务分配候选人。默认返回精简画像（每人数行）；写分配理由前请再调 get_employee_details。可选 name 按姓名/SQL 精确查找（绕过人数上限）。domain/skills/department/role 仅作软提示写入 note，不再硬过滤剔除候选人。",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "员工显示名关键词（通讯录 SQL LIKE）；设置时只返回命中人员完整画像，最多 5 人",
        },
        domain: {
          type: "string",
          description: "已废弃硬过滤；可填 QUALITY/RD 供服务端记入 note 作为偏好提示",
          enum: ["QUALITY", "RD"],
        },
        skills: {
          type: "array",
          items: { type: "string" },
          description: "不再用于硬过滤；可填技能词供 note 提示",
        },
        department: {
          type: "string",
          description: "不再用于硬过滤；可填部门关键词供 note 提示",
        },
        role: {
          type: "string",
          description: "不再用于硬过滤；可填岗位关键词供 note 提示",
        },
      },
      required: [],
    },
  },
};

export const GET_EMPLOYEE_DETAILS_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "get_employee_details",
    description:
      "按 userId 拉取完整能力画像（含 cases 正文、background）。在确定拟推荐人之后调用，用于写 rationale；一次最多 8 人。",
    parameters: {
      type: "object",
      properties: {
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "钉钉 userId 列表，长度 1–8",
        },
      },
      required: ["userIds"],
    },
  },
};

function sharesDepartmentWithActor(p: EmployeeProfileRecord, actorDeptIds: Set<string>): boolean {
  const ids = p.departmentIds;
  if (!ids?.length || actorDeptIds.size === 0) return false;
  return ids.some((id) => actorDeptIds.has(String(id).trim()));
}

function recordFromContactOnly(row: DingTalkContactRow): EmployeeProfileRecord {
  return {
    userId: row.userId,
    displayName: row.name || row.userId,
    department: row.departmentNames?.[0] ?? "未分配部门",
    departmentIds: [...(row.departmentIds ?? [])],
    departmentNames: [...(row.departmentNames ?? [])],
    role: row.position ?? "Employee",
    selfProfile: {
      skillTags: [],
      strengths: [],
      boundaries: [],
      cases: [],
      tools: [],
      availability: {},
    },
  };
}

export function buildGetEmployeeDetailsHandler(repo: {
  get(userId: string): EmployeeProfileRecord | undefined;
}): ToolHandler {
  return (args: Record<string, unknown>) => {
    const raw = args.userIds;
    const userIds = Array.isArray(raw)
      ? raw.map((id) => String(id ?? "").trim()).filter(Boolean).slice(0, 8)
      : [];
    if (userIds.length === 0) {
      return { employees: [] as string[], note: "userIds required" };
    }
    const employees = userIds.map((id) => {
      const rec = repo.get(id);
      if (!rec) return `userId: ${id}\n(displayName missing — not in directory snapshot)`;
      return compressProfileFull(rec);
    });
    return { employees };
  };
}

export function buildSearchEmployeesHandler(
  repo: {
    list(): EmployeeProfileRecord[];
    get?(userId: string): EmployeeProfileRecord | undefined;
  },
  ctx: SearchEmployeesHandlerContext = {},
): ToolHandler {
  // 每个 handler 实例（=每次 orchestrator 调用）维护独立计数。
  // 模型连续反复换参数搜索时，第 N 次起强制截断，避免 max iterations / token budget 爆栈。
  let callCount = 0;
  const quota = searchEmployeesPerOrchestratorQuota();

  return (args: Record<string, unknown>): SearchEmployeesResult | {
    ok: false;
    reason: "search_employees_quota_exhausted";
    callCount: number;
    quota: number;
    hint: string;
  } => {
    callCount += 1;
    if (callCount > quota) {
      return {
        ok: false,
        reason: "search_employees_quota_exhausted",
        callCount,
        quota,
        hint:
          `本轮 search_employees 调用已达上限（${quota} 次）。请在 message 中把当前已经掌握的候选 userId+姓名+部门+岗位列出来，请用户下一句明确选择，**不要再调用本工具**。`,
      };
    }
    const typed = args as unknown as SearchEmployeesArgs;
    const name = String(typed.name ?? "").trim();

    const poolEntries = ctx.candidatePool?.() ?? [];
    const poolActive = poolEntries.length > 0;
    const poolUserIds = new Set(poolEntries.map((p) => p.userId));

    if (name.length > 0) {
      const store = createPeopleDirectoryStore();
      try {
        const contacts = store.searchContacts(name, 10);
        const filtered = poolActive
          ? contacts.filter((c) => poolUserIds.has(c.userId))
          : contacts;
        if (filtered.length === 0) {
          return {
            candidates: [],
            truncated: false,
            total: 0,
            poolConstrained: poolActive || undefined,
            note: poolActive
              ? `候选池内未找到匹配「${name}」的成员；候选池来源：上传花名册。如需扩大范围请先 clear_candidate_pool。`
              : `未找到匹配「${name}」的通讯录用户，请确认姓名或换关键词`,
          };
        }
        const limited = filtered.slice(0, 5);
        const candidates = limited.map((c) => {
          const rec = (repo.get?.(c.userId) ?? repo.list().find((p) => p.userId === c.userId)) ?? recordFromContactOnly(c);
          const baseBlock = compressProfileFull(rec);
          if (poolActive) {
            const note = poolEntries.find((e) => e.userId === c.userId)?.fileNotes;
            return note ? `${baseBlock}\nfileNotes: ${note}` : `${baseBlock}\nfileNotes: (无)`;
          }
          return baseBlock;
        });
        return {
          candidates,
          truncated: false,
          total: filtered.length,
          poolConstrained: poolActive || undefined,
          note: poolActive ? "name_lookup_in_candidate_pool" : "name_lookup_sql",
        };
      } finally {
        store.close();
      }
    }

    if (poolActive) {
      const candidates = poolEntries.map((entry) => {
        const rec = repo.get?.(entry.userId) ?? repo.list().find((p) => p.userId === entry.userId);
        const block = rec
          ? compressProfileBrief(rec, false)
          : `id=${entry.userId} | name=${entry.displayName}\n(画像缺失，仅来自候选池)`;
        return entry.fileNotes ? `${block}\nfileNotes: ${entry.fileNotes}` : block;
      });
      return {
        candidates,
        truncated: false,
        total: poolEntries.length,
        poolConstrained: true,
        note: "candidate_pool_active | full_directory_disabled_for_this_plan",
      };
    }

    const cap = maxCandidatesCap();
    const baseAll = repo.list().filter((p) => p.userId);

    const notes: string[] = [];
    if (typed.domain) notes.push(`domainHint=${typed.domain}`);
    if (typed.skills?.length) notes.push(`skillsHint=${typed.skills.join(",")}`);
    if (typed.department) notes.push(`departmentHint=${typed.department}`);
    if (typed.role) notes.push(`roleHint=${typed.role}`);
    notes.push("soft_hints_only_no_hard_filter");

    let actorDeptIds = new Set<string>();
    if (ctx.actorUserId?.trim()) {
      const store = createPeopleDirectoryStore();
      try {
        const actorContact = store.getContact(ctx.actorUserId.trim());
        for (const id of actorContact?.departmentIds ?? []) {
          actorDeptIds.add(String(id).trim());
        }
      } finally {
        store.close();
      }
    }

    const byId = new Map(baseAll.map((p) => [p.userId, p]));
    const localPool: EmployeeProfileRecord[] = [];
    const nonLocal: EmployeeProfileRecord[] = [];
    if (actorDeptIds.size > 0) {
      for (const p of baseAll) {
        if (p.userId === ctx.actorUserId?.trim() || sharesDepartmentWithActor(p, actorDeptIds)) {
          localPool.push(p);
        } else {
          nonLocal.push(p);
        }
      }
    } else {
      nonLocal.push(...baseAll);
    }

    localPool.sort((a, b) => a.userId.localeCompare(b.userId));
    nonLocal.sort((a, b) => a.userId.localeCompare(b.userId));

    const localSliced = localPool.slice(0, MAX_LOCAL_FIRST);
    const reservedForCross = Math.max(MIN_CROSS_DEPT_SLOTS, cap - localSliced.length);
    const usedIds = new Set(localSliced.map((p) => p.userId));
    const crossTake: EmployeeProfileRecord[] = [];
    for (const p of nonLocal) {
      if (crossTake.length >= reservedForCross) break;
      if (!usedIds.has(p.userId)) {
        usedIds.add(p.userId);
        crossTake.push(p);
      }
    }

    const ordered: EmployeeProfileRecord[] = [...localSliced, ...crossTake].slice(0, cap);
    const total = baseAll.length;
    const truncated = total > ordered.length;
    const candidates = ordered.map((p) =>
      compressProfileBrief(p, sharesDepartmentWithActor(p, actorDeptIds) || p.userId === ctx.actorUserId?.trim()),
    );

    return {
      candidates,
      truncated,
      total,
      note: notes.join(" | "),
    };
  };
}
