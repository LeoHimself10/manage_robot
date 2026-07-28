import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
  type DailyReportOrgConfig,
} from "../daily-report-digest/daily-report-config";
import {
  createDingTalkContactDirectory,
  type DingTalkContactDirectory,
} from "../daily-report-digest/dingtalk-contact-search";

const defaultEvalContactDirectory = createDingTalkContactDirectory();

function resolveConfig(config?: DailyReportDigestConfig): DailyReportDigestConfig {
  return config ?? loadDailyReportDigestConfig().config;
}

function isConfiguredEmployee(org: DailyReportOrgConfig, userId: string): boolean {
  return org.employees.some((employee) => String(employee.userid ?? "").trim() === userId);
}

/**
 * Resolve the configured DingTalk organisations that contain the employee.
 *
 * Competency evaluation used to depend on the historical project-view roster.
 * The daily-report pipeline now scans the organisation directory, so evaluation
 * must use that same current source of truth instead of a manually discovered list.
 */
export async function findOrgsForEvalUser(
  userId: string,
  config?: DailyReportDigestConfig,
  deps?: { directory?: DingTalkContactDirectory },
): Promise<DailyReportOrgConfig[]> {
  const cfg = resolveConfig(config);
  const id = String(userId ?? "").trim();
  if (!id) return [];

  const directMatches = cfg.orgs.filter((org) => isConfiguredEmployee(org, id));
  const directLabels = new Set(directMatches.map((org) => org.label));
  const directory = deps?.directory ?? defaultEvalContactDirectory;

  const lookups = await Promise.allSettled(
    cfg.orgs
      .filter((org) => !directLabels.has(org.label))
      .map(async (org) => {
        if (!org.appKey?.trim() || !org.appSecret?.trim()) return undefined;
        const candidates = await directory.search(org.appKey, org.appSecret, id, 10);
        return candidates.some((candidate) => candidate.userid.trim() === id)
          ? org
          : undefined;
      }),
  );

  const directoryMatches = lookups.flatMap((result) =>
    result.status === "fulfilled" && result.value ? [result.value] : [],
  );
  const matches = [...directMatches, ...directoryMatches];
  if (matches.length > 0) return matches;

  const firstFailure = lookups.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (firstFailure) {
    throw firstFailure.reason instanceof Error
      ? firstFailure.reason
      : new Error(String(firstFailure.reason));
  }
  return [];
}
