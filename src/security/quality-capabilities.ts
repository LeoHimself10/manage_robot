import { existsSync, readFileSync } from "node:fs";

export type QualityBusinessRole =
  | "aftersales_manager"
  | "quality_specialist"
  | "quality_report";

export interface QualityCapabilities {
  roles: QualityBusinessRole[];
  canAccessTracking: boolean;
  canAccessOpinions: boolean;
  /**
   * 质量管理是 employee 的附加能力，不是第四种基础角色。
   * 迁移期继续把旧 QUALITY_SPECIALIST_USER_IDS 视为已授予该能力。
   */
  hasQualityManagement: boolean;
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
  return listQualityManagementUserIds();
}

export function listQualityManagementUserIds(): string[] {
  return [...new Set([
    ...envUserIds("QUALITY_MANAGEMENT_USER_IDS"),
    ...envUserIds("QUALITY_SPECIALIST_USER_IDS"),
  ])].sort();
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
  if (!normalized) {
    return {
      roles: [],
      canAccessTracking: false,
      canAccessOpinions: false,
      hasQualityManagement: false,
      specialistUserIds: [],
    };
  }

  const aftersalesManagers = envUserIds("QUALITY_AFTERSALES_MANAGER_USER_IDS");
  const qualitySpecialists = envUserIds("QUALITY_SPECIALIST_USER_IDS");
  const qualityManagement = new Set(listQualityManagementUserIds());
  const specialistUserIds = specialistUserIdsForReport(normalized);
  const roles: QualityBusinessRole[] = [];
  if (aftersalesManagers.has(normalized)) roles.push("aftersales_manager");
  if (qualitySpecialists.has(normalized)) roles.push("quality_specialist");
  if (specialistUserIds.length > 0) roles.push("quality_report");

  return {
    roles,
    canAccessTracking:
      roles.includes("aftersales_manager") || qualityManagement.has(normalized),
    canAccessOpinions: roles.includes("quality_report"),
    hasQualityManagement: qualityManagement.has(normalized),
    specialistUserIds,
  };
}
