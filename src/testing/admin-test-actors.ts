export type AdminTestActorWorkbenchRole = "manager" | "employee";

export type AdminTestActorKind =
  | "project_manager"
  | "quality_specialist"
  | "manager"
  | "employee";

export interface AdminTestActor {
  userId: string;
  displayName: string;
  workbenchRole: AdminTestActorWorkbenchRole;
  impersonationKind: AdminTestActorKind;
  kindLabel: string;
  departmentId: string;
  departmentName: string;
  position: string;
  supervisorUserId?: string;
}

const TEST_DEPARTMENT_ID = "QUALITY_TEST_DEPT_RND";
const TEST_DEPARTMENT_NAME = "研发中心（测试）";

/**
 * The only identities exposed by the administrator-only isolated test switcher.
 * Keep this order stable: it is also the order shown in the UI.
 */
export const ADMIN_TEST_ACTORS: readonly AdminTestActor[] = Object.freeze([
  {
    userId: "QUALITY_TEST_AFTERSALES_001",
    displayName: "马荣鑫（测试）",
    workbenchRole: "manager",
    impersonationKind: "project_manager",
    kindLabel: "质量初研",
    departmentId: "QUALITY_TEST_DEPT_AFTERSALES",
    departmentName: "售后服务部（测试）",
    position: "质量初研负责人",
  },
  {
    userId: "QUALITY_TEST_SPECIALIST_001",
    displayName: "佟成（测试）",
    workbenchRole: "employee",
    impersonationKind: "quality_specialist",
    kindLabel: "质量管理",
    departmentId: "QUALITY_TEST_DEPT_QUALITY",
    departmentName: "质量部（测试）",
    position: "质量专员",
  },
  {
    userId: "QUALITY_TEST_EMPLOYEE_001",
    displayName: "测试员工1",
    workbenchRole: "employee",
    impersonationKind: "employee",
    kindLabel: "测试员工",
    departmentId: TEST_DEPARTMENT_ID,
    departmentName: TEST_DEPARTMENT_NAME,
    position: "测试执行员工",
    supervisorUserId: "QUALITY_TEST_MANAGER_001",
  },
  {
    userId: "QUALITY_TEST_EMPLOYEE_002",
    displayName: "测试员工2",
    workbenchRole: "employee",
    impersonationKind: "employee",
    kindLabel: "测试员工",
    departmentId: TEST_DEPARTMENT_ID,
    departmentName: TEST_DEPARTMENT_NAME,
    position: "测试执行员工",
    supervisorUserId: "QUALITY_TEST_MANAGER_001",
  },
  {
    userId: "QUALITY_TEST_EMPLOYEE_003",
    displayName: "测试员工3",
    workbenchRole: "employee",
    impersonationKind: "employee",
    kindLabel: "测试员工",
    departmentId: TEST_DEPARTMENT_ID,
    departmentName: TEST_DEPARTMENT_NAME,
    position: "测试执行员工",
    supervisorUserId: "QUALITY_TEST_MANAGER_001",
  },
  {
    userId: "QUALITY_TEST_MANAGER_001",
    displayName: "测试主管",
    workbenchRole: "manager",
    impersonationKind: "manager",
    kindLabel: "测试主管",
    departmentId: TEST_DEPARTMENT_ID,
    departmentName: TEST_DEPARTMENT_NAME,
    position: "测试主管",
  },
]);

const ACTOR_BY_USER_ID = new Map(ADMIN_TEST_ACTORS.map((actor) => [actor.userId, actor]));

export function isAdminTestSystemEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(environment.WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function getAdminTestActor(
  userId: string | null | undefined,
): AdminTestActor | undefined {
  if (!isAdminTestSystemEnabled()) return undefined;
  return ACTOR_BY_USER_ID.get(String(userId ?? "").trim());
}

/**
 * Notification safety also covers retired QUALITY_TEST_* rows that may remain
 * in SQLite. They must never become real DingTalk recipients.
 */
export function isAdminTestActorUserId(userId: string | null | undefined): boolean {
  if (!isAdminTestSystemEnabled()) return false;
  return String(userId ?? "").trim().startsWith("QUALITY_TEST_");
}

export function listAdminTestActors(query?: string): AdminTestActor[] {
  if (!isAdminTestSystemEnabled()) return [];
  const normalized = String(query ?? "").trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return [...ADMIN_TEST_ACTORS];
  return ADMIN_TEST_ACTORS.filter((actor) => [
    actor.userId,
    actor.displayName,
    actor.departmentName,
    actor.position,
    actor.kindLabel,
  ].join(" ").toLocaleLowerCase("zh-CN").includes(normalized));
}
