export type QualityPerspective = "aftersales" | "quality_management" | "manager" | "employee" | "dashboard";

export interface QualityTestActor {
  actorRef:
    | "aftersales"
    | "quality-management"
    | "manager-1"
    | "manager-2"
    | "employee-1"
    | "employee-2"
    | "employee-3";
  userId: string;
  displayName: string;
  perspective: Exclude<QualityPerspective, "dashboard">;
  departmentName: string | null;
}

export const QUALITY_TEST_ACTORS: readonly QualityTestActor[] = Object.freeze([
  {
    actorRef: "aftersales",
    userId: "QUALITY_TEST_AFTERSALES_001",
    displayName: "马荣鑫（测试）",
    perspective: "aftersales",
    departmentName: null,
  },
  {
    actorRef: "quality-management",
    userId: "QUALITY_TEST_SPECIALIST_001",
    displayName: "佟成（测试）",
    perspective: "quality_management",
    departmentName: null,
  },
  {
    actorRef: "manager-1",
    userId: "QUALITY_TEST_MANAGER_001",
    displayName: "主管一（测试）",
    perspective: "manager",
    departmentName: "研发中心",
  },
  {
    actorRef: "manager-2",
    userId: "QUALITY_TEST_MANAGER_002",
    displayName: "主管二（测试）",
    perspective: "manager",
    departmentName: "质量部",
  },
  {
    actorRef: "employee-1",
    userId: "QUALITY_TEST_EMPLOYEE_001",
    displayName: "员工一（测试）",
    perspective: "employee",
    departmentName: "研发中心",
  },
  {
    actorRef: "employee-2",
    userId: "QUALITY_TEST_EMPLOYEE_002",
    displayName: "员工二（测试）",
    perspective: "employee",
    departmentName: "研发中心",
  },
  {
    actorRef: "employee-3",
    userId: "QUALITY_TEST_EMPLOYEE_003",
    displayName: "员工三（测试）",
    perspective: "employee",
    departmentName: "质量部",
  },
]);

const BY_REF = new Map(QUALITY_TEST_ACTORS.map((actor) => [actor.actorRef, actor]));
const BY_USER_ID = new Map(QUALITY_TEST_ACTORS.map((actor) => [actor.userId, actor]));

export function resolveQualityTestActor(actorRef: string | null | undefined): QualityTestActor | null {
  return BY_REF.get(String(actorRef ?? "").trim() as QualityTestActor["actorRef"]) ?? null;
}

export function getQualityTestActorByUserId(userId: string | null | undefined): QualityTestActor | null {
  return BY_USER_ID.get(String(userId ?? "").trim()) ?? null;
}

export function isQualityTestActorUserId(userId: string | null | undefined): boolean {
  return getQualityTestActorByUserId(userId) != null;
}

export function listQualityTestManagerActors(): QualityTestActor[] {
  return QUALITY_TEST_ACTORS.filter((actor) => actor.perspective === "manager");
}

export function listQualityTestEmployeeActors(): QualityTestActor[] {
  return QUALITY_TEST_ACTORS.filter((actor) => actor.perspective === "employee");
}
