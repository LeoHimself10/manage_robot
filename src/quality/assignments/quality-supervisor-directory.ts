import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createPeopleDirectoryStore, type DingTalkContactRow } from "../../infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { listQualityTestManagerActors } from "../testing/quality-test-actors";

export const QUALITY_SUPERVISOR_DEPARTMENTS = Object.freeze([
  "研发中心",
  "医学事务部",
  "质量部",
  "交付中心",
  "广州市微光医疗器械技术有限公司",
  "微光创新（安徽）医疗科技有限公司",
  "湘潭市微影医疗器械有限公司",
]);

const DEFAULT_EXCLUDED_USER_IDS = ["014517256544"];

interface DepartmentRoute {
  name: string;
  departmentIds: string[];
  departmentNames: string[];
}

interface SupplementalSupervisor {
  userId: string;
  departmentName: string;
}

interface SupervisorRoutingConfig {
  departments: DepartmentRoute[];
  supplementalSupervisors: SupplementalSupervisor[];
  excludedUserIds: string[];
}

export interface QualitySupervisorOption {
  candidateRef: string;
  displayName: string;
  departmentName: string;
}

export interface QualitySupervisorGroup {
  departmentName: string;
  supervisors: QualitySupervisorOption[];
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function flexibleStrings(value: unknown): string[] {
  if (Array.isArray(value)) return strings(value);
  const text = String(value ?? "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return strings(parsed);
  } catch {
    // DingTalk payload variants also use comma-separated department ids.
  }
  return [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
}

function defaultConfig(): SupervisorRoutingConfig {
  return {
    departments: QUALITY_SUPERVISOR_DEPARTMENTS.map((name) => ({
      name,
      departmentIds: [],
      departmentNames: [name],
    })),
    supplementalSupervisors: [],
    excludedUserIds: [...DEFAULT_EXCLUDED_USER_IDS],
  };
}

function readConfig(): SupervisorRoutingConfig {
  const fallback = defaultConfig();
  const path = String(
    process.env.QUALITY_SUPERVISOR_ROUTING_FILE ?? "data/quality-supervisor-routing.json",
  ).trim();
  if (!path || !existsSync(path)) return fallback;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const byName = new Map<string, DepartmentRoute>();
    for (const item of Array.isArray(raw.departments) ? raw.departments : []) {
      const row = item as Record<string, unknown>;
      const name = String(row.name ?? "").trim();
      if (!QUALITY_SUPERVISOR_DEPARTMENTS.includes(name)) continue;
      byName.set(name, {
        name,
        departmentIds: strings(row.departmentIds),
        departmentNames: [...new Set([name, ...strings(row.departmentNames)])],
      });
    }
    const departments = QUALITY_SUPERVISOR_DEPARTMENTS.map((name) => byName.get(name) ?? {
      name,
      departmentIds: [],
      departmentNames: [name],
    });
    const supplementalSupervisors = (Array.isArray(raw.supplementalSupervisors)
      ? raw.supplementalSupervisors
      : [])
      .map((item) => item as Record<string, unknown>)
      .map((item) => ({
        userId: String(item.userId ?? "").trim(),
        departmentName: String(item.departmentName ?? "").trim(),
      }))
      .filter((item) => item.userId && QUALITY_SUPERVISOR_DEPARTMENTS.includes(item.departmentName));
    return {
      departments,
      supplementalSupervisors,
      excludedUserIds: [...new Set([
        ...DEFAULT_EXCLUDED_USER_IDS,
        ...strings(raw.excludedUserIds),
        ...String(process.env.QUALITY_SUPERVISOR_EXCLUDED_USER_IDS ?? "")
          .split(",").map((item) => item.trim()).filter(Boolean),
      ])],
    };
  } catch {
    return fallback;
  }
}

function truthy(value: unknown): boolean {
  return value === true || value === 1 || ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
}

function contactLeadsDepartment(contact: DingTalkContactRow, route: DepartmentRoute): boolean {
  const raw = contact.rawJson ?? {};
  const matchingDepartmentIds = new Set(route.departmentIds);
  contact.departmentNames.forEach((name, index) => {
    if (route.departmentNames.includes(name) && contact.departmentIds[index]) {
      matchingDepartmentIds.add(contact.departmentIds[index]!);
    }
  });
  const orderLists = [raw.dept_order_list, raw.deptOrderList, raw.department_order_list]
    .filter(Array.isArray) as unknown[][];
  for (const orderList of orderLists) {
    for (const item of orderList) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const deptId = String(row.dept_id ?? row.deptId ?? "").trim();
      if (truthy(row.leader ?? row.is_leader ?? row.isLeader)
        && (!deptId || matchingDepartmentIds.has(deptId))) {
        return true;
      }
    }
  }
  const leaderDeptIds = flexibleStrings(raw.leader_in_dept ?? raw.leaderInDept ?? raw.leader_dept_ids);
  return leaderDeptIds.some((deptId) => matchingDepartmentIds.has(deptId));
}

function contactMatchesDepartment(contact: DingTalkContactRow, route: DepartmentRoute): boolean {
  return contact.departmentIds.some((id) => route.departmentIds.includes(id))
    || contact.departmentNames.some((name) => route.departmentNames.includes(name));
}

function candidateRef(eventId: string, userId: string, departmentName: string): string {
  const secret = String(process.env.QUALITY_ACTION_REF_SECRET ?? "quality-supervisor-v1");
  return `candidate:${createHash("sha256")
    .update(`${secret}|${eventId}|${userId}|${departmentName}`)
    .digest("base64url")}`;
}

export function createQualitySupervisorDirectory(deps?: {
  dbPath?: string;
  contacts?: DingTalkContactRow[];
  config?: SupervisorRoutingConfig;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  const people = deps?.contacts ? null : createPeopleDirectoryStore(dbPath);
  const contacts = deps?.contacts ?? people!.listContacts();
  const config = deps?.config ?? readConfig();
  const excluded = new Set(config.excludedUserIds);
  const supplemental = new Map(config.supplementalSupervisors.map((item) => [item.userId, item.departmentName]));

  function realCandidates(eventId: string): Array<QualitySupervisorOption & { userId: string }> {
    const candidates: Array<QualitySupervisorOption & { userId: string }> = [];
    for (const contact of contacts) {
      if (!contact.active || contact.deletedAt || excluded.has(contact.userId)) continue;
      const supplementalDepartment = supplemental.get(contact.userId);
      for (const route of config.departments) {
        if (!contactMatchesDepartment(contact, route)) continue;
        if (supplementalDepartment !== route.name && !contactLeadsDepartment(contact, route)) continue;
        candidates.push({
          userId: contact.userId,
          candidateRef: candidateRef(eventId, contact.userId, route.name),
          displayName: contact.name || "姓名暂不可用",
          departmentName: route.name,
        });
      }
    }
    return candidates.sort((a, b) => a.departmentName.localeCompare(b.departmentName, "zh-CN")
      || a.displayName.localeCompare(b.displayName, "zh-CN"));
  }

  function testCandidates(eventId: string): Array<QualitySupervisorOption & { userId: string }> {
    return listQualityTestManagerActors().map((actor) => ({
      userId: actor.userId,
      candidateRef: candidateRef(eventId, actor.userId, actor.departmentName!),
      displayName: actor.displayName,
      departmentName: actor.departmentName!,
    }));
  }

  function candidates(eventId: string, isTest: boolean) {
    return isTest ? testCandidates(eventId) : realCandidates(eventId);
  }

  function listGroups(input: { eventId: string; isTest: boolean; query?: string }): QualitySupervisorGroup[] {
    const query = String(input.query ?? "").trim().toLocaleLowerCase("zh-CN");
    const available = candidates(input.eventId, input.isTest)
      .filter((item) => !query || item.displayName.toLocaleLowerCase("zh-CN").includes(query));
    return QUALITY_SUPERVISOR_DEPARTMENTS.map((departmentName) => ({
      departmentName,
      supervisors: available
        .filter((item) => item.departmentName === departmentName)
        .map(({ candidateRef: ref, displayName, departmentName: department }) => ({
          candidateRef: ref,
          displayName,
          departmentName: department,
        })),
    }));
  }

  function resolveCandidate(input: { eventId: string; isTest: boolean; candidateRef: string }) {
    return candidates(input.eventId, input.isTest)
      .find((item) => item.candidateRef === input.candidateRef) ?? null;
  }

  function resolveEligibleUser(input: {
    eventId: string;
    isTest: boolean;
    userId: string;
    departmentName: string;
  }) {
    return candidates(input.eventId, input.isTest).find((item) =>
      item.userId === input.userId && item.departmentName === input.departmentName,
    ) ?? null;
  }

  function assertDepartmentEmployee(input: {
    eventIsTest: boolean;
    managerDepartmentName: string;
    employeeUserId: string;
  }): DingTalkContactRow {
    if (input.eventIsTest) throw new Error("测试流程未配置测试员工，不能向真实员工分配");
    const route = config.departments.find((item) => item.name === input.managerDepartmentName);
    if (!route) throw new Error("主管所属部门不在质量任务范围内");
    const contact = contacts.find((item) => item.userId === input.employeeUserId);
    if (!contact?.active || contact.deletedAt) throw new Error("目标员工不在有效通讯录中");
    if (!contactMatchesDepartment(contact, route)) throw new Error("主管只能向自己部门的员工分配");
    if (realCandidates("employee-boundary").some((item) => item.userId === contact.userId)) {
      throw new Error("质量主管节点不能继续转派给其他主管");
    }
    return contact;
  }

  return {
    listGroups,
    resolveCandidate,
    resolveEligibleUser,
    assertDepartmentEmployee,
    close: () => people?.close(),
  };
}
