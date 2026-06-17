import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";
import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import { filterReportEntry } from "./daily-report-content-filter";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
} from "./dingtalk-report-client";
import { listOrgScanContacts } from "./daily-report-org-scan-contacts";
import { createDingTalkContactDirectory } from "./dingtalk-contact-search";
import { filterReportEntryByModuleProjectPair } from "./daily-report-project-view-filter";
import {
  createProjectViewRosterStore,
  listProjectViewRoster,
  mergeDiscoveryMembers,
  type ProjectViewRosterMember,
  type ProjectViewRosterStore,
} from "./daily-report-project-view-roster-store";
import {
  findProjectViewById,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import { resolveDayRangeForYmd } from "./daily-report-window";

export const DEFAULT_PROJECT_VIEW_DISCOVERY_DAYS = 30;

function envInt(name: string, defaultValue: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

export function scanConcurrencyLimit(): number {
  return envInt("DAILY_REPORT_PROJECT_VIEW_SCAN_CONCURRENCY", 12);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function calendarDaysBack(
  now: Date,
  timezone: string,
  discoveryDays: number,
): string[] {
  const todayYmd = formatDateInTz(now.toISOString(), timezone);
  const days: string[] = [];
  for (let d = 0; d < discoveryDays; d += 1) {
    days.push(addDaysToYmd(todayYmd, -d));
  }
  return days;
}

async function contactHasMatchingReport(
  org: DailyReportOrgConfig,
  view: DailyReportProjectViewConfig,
  contact: { userid: string; name: string },
  dayYmds: string[],
  config: Pick<
    DailyReportDigestConfig,
    "timezone" | "reportDayCutoffHour" | "reportDayCutoffMinute"
  >,
  client: DingTalkReportClient,
): Promise<boolean> {
  for (const ymd of dayYmds) {
    const range = resolveDayRangeForYmd(ymd, config.timezone, {
      cutoffHour: config.reportDayCutoffHour,
      cutoffMinute: config.reportDayCutoffMinute,
    });
    const reps = await client.fetchUserReports({
      appKey: org.appKey,
      appSecret: org.appSecret,
      userid: contact.userid,
      templateName: org.templateName,
      startTime: range.startTime,
      endTime: range.endTime,
    });
    const hasMatch = reps
      .map((r) => filterReportEntryByModuleProjectPair(r, view.filters))
      .map((r) => filterReportEntry(r))
      .some((r) => r.contents.length > 0);
    if (hasMatch) return true;
  }
  return false;
}

export interface ProjectViewDiscoveryDeps {
  reportClient?: DingTalkReportClient;
  fetchImpl?: typeof fetch;
  rosterStore?: ProjectViewRosterStore;
  now?: Date;
  concurrency?: number;
  /** 测试注入：覆盖 listOrgScanContacts 结果 */
  scanContacts?: Array<{ userid: string; name: string }>;
}

export async function discoverProjectViewMembers(
  org: DailyReportOrgConfig,
  view: DailyReportProjectViewConfig,
  discoveryDays: number,
  config: Pick<
    DailyReportDigestConfig,
    "timezone" | "reportDayCutoffHour" | "reportDayCutoffMinute"
  >,
  deps?: ProjectViewDiscoveryDeps,
): Promise<Array<{ userid: string; name: string }>> {
  const client =
    deps?.reportClient ?? createDingTalkReportClient({ fetchImpl: deps?.fetchImpl });
  const now = deps?.now ?? new Date();
  const dayYmds = calendarDaysBack(now, config.timezone, discoveryDays);
  const contacts =
    deps?.scanContacts ??
    (await listOrgScanContacts(org, {
      directory: deps?.fetchImpl
        ? createDingTalkContactDirectory({ fetchImpl: deps.fetchImpl })
        : undefined,
    }));
  const limit = deps?.concurrency ?? scanConcurrencyLimit();

  const hits = await mapWithConcurrency(contacts, limit, async (contact) => {
    const matched = await contactHasMatchingReport(
      org,
      view,
      contact,
      dayYmds,
      config,
      client,
    );
    return matched ? contact : null;
  });

  return hits.filter((c): c is { userid: string; name: string } => c != null);
}

export async function runProjectViewDiscovery(
  viewId: string,
  config: DailyReportDigestConfig,
  deps?: ProjectViewDiscoveryDeps,
): Promise<{
  added: number;
  totalRoster: number;
  discovered: ProjectViewRosterMember[];
}> {
  const view = findProjectViewById(config, viewId);
  if (!view) {
    throw new Error(`project view not found: ${viewId}`);
  }
  const org = config.orgs.find((o) => o.label === view.orgLabel);
  if (!org) {
    throw new Error(`org not found for view: ${viewId}`);
  }

  const discoveryDays = view.discoveryDays ?? DEFAULT_PROJECT_VIEW_DISCOVERY_DAYS;
  const discoveredContacts = await discoverProjectViewMembers(
    org,
    view,
    discoveryDays,
    config,
    deps,
  );
  const members: ProjectViewRosterMember[] = discoveredContacts.map((c) => ({
    userid: c.userid,
    name: c.name,
    source: "discovery",
  }));

  const rosterStore = deps?.rosterStore ?? createProjectViewRosterStore();
  const ownsStore = !deps?.rosterStore;
  try {
    const added = mergeDiscoveryMembers(viewId, members, rosterStore);
    const totalRoster = listProjectViewRoster(viewId, rosterStore).length;
    return { added, totalRoster, discovered: members };
  } finally {
    if (ownsStore) rosterStore.close();
  }
}
