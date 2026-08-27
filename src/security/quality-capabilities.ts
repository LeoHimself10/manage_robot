import { existsSync, readFileSync } from "node:fs";
import {
  resolveWorkbenchRole,
  type WorkbenchRole,
} from "./workbench-role-resolver";
import { getAdminTestActor } from "../testing/admin-test-actors";

export type QualityBusinessRole =
  | "aftersales_manager"
  | "quality_specialist"
  | "quality_report";

export interface QualityCapabilities {
  baseRole: WorkbenchRole;
  roles: QualityBusinessRole[];
  canAccessTracking: boolean;
  canAccessOpinions: boolean;
  canReportQuality: boolean;
  canAnalyzeQuality: boolean;
  isBusinessReadOnly: boolean;
  hasQualityManagement: boolean;
  isProjectManager: boolean;
  isQualitySpecialist: boolean;
  specialistUserIds: string[];
}

function envUserIds(name: string): Set<string> {
  return new Set(
    String(process.env[name] ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function readSpecialistReports(): Record<string, string[]> {
  const path = String(
    process.env.QUALITY_SPECIALIST_REPORTS_FILE ?? "data/quality-specialist-reports.json",
  ).trim();
  if (!path || !existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string[]> = {};
    for (const [specialistUserId, rawReports] of Object.entries(parsed)) {
      const specialist = specialistUserId.trim();
      if (!specialist || !Array.isArray(rawReports)) continue;
      result[specialist] = Array.from(
        new Set(rawReports.map((item) => String(item ?? "").trim()).filter(Boolean)),
      );
    }
    return result;
  } catch {
    return {};
  }
}

function specialistUserIdsForReport(reportUserId: string): string[] {
  const normalized = reportUserId.trim();
  if (!normalized) return [];
  if (getAdminTestActor(normalized)?.userId === "QUALITY_TEST_AFTERSALES_001") {
    return ["QUALITY_TEST_SPECIALIST_001"];
  }
  const configuredSpecialists = envUserIds("QUALITY_SPECIALIST_USER_IDS");
  const reports = readSpecialistReports();
  return Object.entries(reports)
    .filter(([specialistUserId, reportUserIds]) =>
      configuredSpecialists.has(specialistUserId) && reportUserIds.includes(normalized),
    )
    .map(([specialistUserId]) => specialistUserId)
    .sort();
}

export function listQualitySpecialistUserIds(): string[] {
  return [...new Set([
    ...envUserIds("QUALITY_MANAGEMENT_USER_IDS"),
    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),
    ...(getAdminTestActor("QUALITY_TEST_SPECIALIST_001")
      ? ["QUALITY_TEST_SPECIALIST_001"]
      : []),
  ])]
    // A quality specialist is an employee overlay. Stale or mistaken manager /
    // admin entries must neither gain the capability nor receive business
    // notifications intended for quality specialists.
    .filter((userId) => resolveWorkbenchRole(userId) === "employee")
    .sort();
}

export function listQualityAftersalesManagerUserIds(): string[] {
  return [...envUserIds("QUALITY_AFTERSALES_MANAGER_USER_IDS")].sort();
}

export function isQualitySpecialistForReport(
  specialistUserId: string,
  reportUserId: string,
): boolean {
  const specialist = specialistUserId.trim();
  if (!specialist) return false;
  return specialistUserIdsForReport(reportUserId).includes(specialist);
}

export function resolveQualityCapabilities(userId: string): QualityCapabilities {
  const normalized = String(userId ?? "").trim();
  const baseRole = resolveWorkbenchRole(normalized);
  if (!normalized) {
    return {
      baseRole,
      roles: [],
      canAccessTracking: false,
      canAccessOpinions: false,
      canReportQuality: false,
      canAnalyzeQuality: false,
      isBusinessReadOnly: false,
      hasQualityManagement: false,
      isProjectManager: false,
      isQualitySpecialist: false,
      specialistUserIds: [],
    };
  }

  const testActor = getAdminTestActor(normalized);
  if (testActor) {
    const isAftersales = testActor.userId === "QUALITY_TEST_AFTERSALES_001";
    const isQualitySpecialist = testActor.userId === "QUALITY_TEST_SPECIALIST_001";
    return {
      baseRole,
      roles: isAftersales
        ? ["aftersales_manager"]
        : isQualitySpecialist
          ? ["quality_specialist"]
          : [],
      canAccessTracking: true,
      canAccessOpinions: false,
      canReportQuality: isAftersales,
      canAnalyzeQuality: isQualitySpecialist,
      isBusinessReadOnly: false,
      hasQualityManagement: isQualitySpecialist,
      isProjectManager: isAftersales,
      isQualitySpecialist,
      specialistUserIds: isAftersales ? ["QUALITY_TEST_SPECIALIST_001"] : [],
    };
  }

  const aftersalesManagers = envUserIds("QUALITY_AFTERSALES_MANAGER_USER_IDS");
  const qualitySpecialists = new Set(listQualitySpecialistUserIds());
  const specialistUserIds = specialistUserIdsForReport(normalized);
  // QUALITY_AFTERSALES_MANAGER_USER_IDS is the existing explicit manager
  // allowlist for this bounded business workflow. Keep it authoritative for
  // backwards-compatible deployments where the general workbench manager
  // directory is configured separately. Administrators remain read-only.
  // The two quality identities are constrained overlays, not independent roles:
  // manager -> optional project manager; employee -> optional quality specialist.
  // An allowlist entry never changes the user's base role and never grants an
  // administrator business write access.
  const canReportQuality = baseRole === "manager" && aftersalesManagers.has(normalized);
  const hasQualityManagement = baseRole === "employee" && qualitySpecialists.has(normalized);
  const roles: QualityBusinessRole[] = [];
  if (canReportQuality) roles.push("aftersales_manager");
  // Legacy role name is retained only as a compatibility facade. The product
  // capability is employee/admin + quality_management, not a fourth role.
  if (hasQualityManagement) roles.push("quality_specialist");
  if (specialistUserIds.length > 0) roles.push("quality_report");

  return {
    baseRole,
    roles,
    canAccessTracking: baseRole === "admin" || canReportQuality || hasQualityManagement,
    canAccessOpinions: roles.includes("quality_report"),
    canReportQuality,
    canAnalyzeQuality: hasQualityManagement,
    isBusinessReadOnly: baseRole === "admin",
    hasQualityManagement,
    isProjectManager: canReportQuality,
    isQualitySpecialist: hasQualityManagement,
    specialistUserIds,
  };
}
