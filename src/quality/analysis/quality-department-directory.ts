import { createPeopleDirectoryStore } from "../../infra/people-directory-store";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { listWorkbenchManagerIds } from "../../security/workbench-manager-whitelist";

export interface QualityDepartment {
  departmentId: string;
  departmentName: string;
  activeMemberCount: number;
}

export interface QualityDepartmentManagerResolution {
  status: "READY" | "DEPARTMENT_NOT_FOUND" | "NO_MANAGER" | "INACTIVE_MANAGER" | "AMBIGUOUS";
  department: QualityDepartment | null;
  managerUserId: string | null;
  managerName: string | null;
  managerAccountActive: boolean;
  message: string;
}

export interface QualityManagerPerspective {
  departmentId: string;
  departmentName: string;
  managerUserId: string;
  managerName: string;
  label: string;
}

function departmentPairs(contact: {
  departmentIds: string[];
  departmentNames: string[];
}): Array<{ departmentId: string; departmentName: string }> {
  const length = Math.max(contact.departmentIds.length, contact.departmentNames.length);
  const result: Array<{ departmentId: string; departmentName: string }> = [];
  for (let index = 0; index < length; index += 1) {
    const name = String(contact.departmentNames[index] ?? "").trim();
    const rawId = String(contact.departmentIds[index] ?? "").trim();
    if (!name && !rawId) continue;
    result.push({
      departmentId: rawId || `name:${name.toLocaleLowerCase("zh-CN")}`,
      departmentName: name || rawId,
    });
  }
  return result;
}

export function createQualityDepartmentDirectory(dbPath = resolveWorkbenchSqlitePath()) {
  const people = createPeopleDirectoryStore(dbPath);

  function listDepartments(query = ""): QualityDepartment[] {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const byId = new Map<string, QualityDepartment>();
    for (const contact of people.listContacts()) {
      if (!contact.active) continue;
      for (const pair of departmentPairs(contact)) {
        const existing = byId.get(pair.departmentId);
        if (existing) existing.activeMemberCount += 1;
        else byId.set(pair.departmentId, { ...pair, activeMemberCount: 1 });
      }
    }
    return [...byId.values()]
      .filter((item) => !normalizedQuery
        || `${item.departmentId} ${item.departmentName}`
          .toLocaleLowerCase("zh-CN").includes(normalizedQuery))
      .sort((left, right) => left.departmentName.localeCompare(right.departmentName, "zh-CN")
        || left.departmentId.localeCompare(right.departmentId));
  }

  function resolveManager(departmentId: string): QualityDepartmentManagerResolution {
    const department = listDepartments().find((item) => item.departmentId === departmentId) ?? null;
    if (!department) {
      return {
        status: "DEPARTMENT_NOT_FOUND",
        department: null,
        managerUserId: null,
        managerName: null,
        managerAccountActive: false,
        message: "所选部门不存在或已从通讯录移除，请重新选择。",
      };
    }
    const managerIds = listWorkbenchManagerIds();
    const candidates = people.listContacts().filter((contact) => {
      if (!managerIds.has(contact.userId)) return false;
      return departmentPairs(contact).some((item) => item.departmentId === departmentId);
    });
    const active = candidates.filter((item) => item.active);
    if (active.length > 1) {
      return {
        status: "AMBIGUOUS",
        department,
        managerUserId: null,
        managerName: null,
        managerAccountActive: false,
        message: `部门“${department.departmentName}”匹配到多名主管，请管理员先完善唯一主管映射。`,
      };
    }
    if (active.length === 1) {
      return {
        status: "READY",
        department,
        managerUserId: active[0]!.userId,
        managerName: active[0]!.name,
        managerAccountActive: true,
        message: "主管映射有效，可以确认正式初析。",
      };
    }
    if (candidates.length > 0) {
      return {
        status: "INACTIVE_MANAGER",
        department,
        managerUserId: candidates.length === 1 ? candidates[0]!.userId : null,
        managerName: candidates.length === 1 ? candidates[0]!.name : null,
        managerAccountActive: false,
        message: `部门“${department.departmentName}”的主管账号已停用，请先恢复账号或更新主管映射。`,
      };
    }
    return {
      status: "NO_MANAGER",
      department,
      managerUserId: null,
      managerName: null,
      managerAccountActive: false,
      message: `部门“${department.departmentName}”尚未配置主管，无法进入任务规划。`,
    };
  }

  function listManagerPerspectives(): QualityManagerPerspective[] {
    const resolved = listDepartments()
      .map((department) => resolveManager(department.departmentId))
      .filter((resolution): resolution is QualityDepartmentManagerResolution & {
        department: QualityDepartment;
        managerUserId: string;
        managerName: string;
      } => resolution.status === "READY"
        && Boolean(resolution.department)
        && Boolean(resolution.managerUserId)
        && Boolean(resolution.managerName))
      .map((resolution) => ({
        departmentId: resolution.department.departmentId,
        departmentName: resolution.department.departmentName,
        managerUserId: resolution.managerUserId,
        managerName: resolution.managerName,
        label: `${resolution.department.departmentName}主管（${resolution.managerName}）`,
      }));
    const byManager = new Map<string, QualityManagerPerspective>();
    for (const item of resolved) {
      const existing = byManager.get(item.managerUserId);
      if (!existing) {
        byManager.set(item.managerUserId, item);
        continue;
      }
      const names = [...new Set([
        ...existing.departmentName.split("、"),
        item.departmentName,
      ])].sort((left, right) => left.localeCompare(right, "zh-CN"));
      existing.departmentName = names.join("、");
      existing.label = `${existing.departmentName}主管（${existing.managerName}）`;
    }
    return [...byManager.values()]
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }

  return { listDepartments, resolveManager, listManagerPerspectives, close: () => people.close() };
}
