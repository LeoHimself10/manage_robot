import type { DailyReportOrgConfig } from "./daily-report-config";
import type { OrgDigest } from "./daily-report-build";
import {
  listProjectViewIdsForPartition,
  mergePartitionedReports,
  partitionReportEntry,
} from "./daily-report-day-partition";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
} from "./dingtalk-report-client";
import { mapWithConcurrency } from "./daily-report-project-view-discovery";
import {
  listProjectViewsFromConfig,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import { reportEligibleForUnifiedPartition } from "./daily-report-rd-template-gate";
import {
  resolveUnifiedScanContacts,
  type UnifiedDayScanMode,
} from "./daily-report-unified-scan-contacts";
import type { ProjectViewRosterStore } from "./daily-report-project-view-roster-store";
import type { ReportTimeRange } from "./daily-report-window";
import { logStructured } from "../../infra/logger";

export interface UnifiedDayCollectResult {
  poolCount: number;
  scanContactCount?: number;
  byViewId: Map<string, OrgDigest>;
  errors: OrgDigest["errors"];
}

export async function collectUnifiedDayPartition(params: {
  org: DailyReportOrgConfig;
  range: ReportTimeRange;
  projectViews: Array<DailyReportProjectViewConfig & { orgLabel: string }>;
  reportClient?: DingTalkReportClient;
  fetchImpl?: typeof fetch;
  scanContacts?: Array<{ userid: string; name: string }>;
  scanMode?: UnifiedDayScanMode;
  rosterStore?: ProjectViewRosterStore;
}): Promise<UnifiedDayCollectResult> {
  const client =
    params.reportClient ?? createDingTalkReportClient({ fetchImpl: params.fetchImpl });
  const contacts =
    params.scanContacts ??
    (await resolveUnifiedScanContacts({
      org: params.org,
      projectViews: params.projectViews,
      scanMode: params.scanMode ?? "full",
      rosterStore: params.rosterStore,
    }));
  const viewIds = listProjectViewIdsForPartition(params.projectViews);
  const errors: OrgDigest["errors"] = [];
  const partitionedRows: Array<{
    userid: string;
    name: string;
    byViewId: Map<string, import("./dingtalk-report-client").ReportEntry[]>;
  }> = [];

  const concurrency = Number(process.env.DAILY_REPORT_PROJECT_VIEW_SCAN_CONCURRENCY || 12);

  await mapWithConcurrency(contacts, concurrency, async (contact) => {
    try {
      const reps = await client.fetchUserReports({
        appKey: params.org.appKey,
        appSecret: params.org.appSecret,
        userid: contact.userid,
        templateName: params.org.templateName,
        startTime: params.range.startTime,
        endTime: params.range.endTime,
      });
      const eligible = reps.filter((r) =>
        reportEligibleForUnifiedPartition(r, params.projectViews),
      );
      if (eligible.length === 0) return;

      const byViewId = new Map<string, import("./dingtalk-report-client").ReportEntry[]>();
      for (const report of eligible) {
        const part = partitionReportEntry(report, params.projectViews);
        for (const [viewId, entries] of part.byViewId) {
          const existing = byViewId.get(viewId) ?? [];
          byViewId.set(viewId, [...existing, ...entries]);
        }
      }

      if ([...byViewId.values()].some((arr) => arr.length > 0)) {
        partitionedRows.push({
          userid: contact.userid,
          name: contact.name,
          byViewId,
        });
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      errors.push({
        userid: contact.userid,
        name: contact.name?.trim() || contact.userid,
        reason,
      });
      logStructured({
        event: "daily_report_unified_collect_fetch_failed",
        org: params.org.label,
        userid: contact.userid,
        reason,
      });
    }
  });

  const merged = mergePartitionedReports(params.org.label, partitionedRows, viewIds);
  return {
    poolCount: merged.poolUserIds.size,
    scanContactCount: contacts.length,
    byViewId: merged.byViewId,
    errors,
  };
}

export async function collectUnifiedDayForOrg(
  org: DailyReportOrgConfig,
  range: ReportTimeRange,
  deps?: {
    reportClient?: DingTalkReportClient;
    fetchImpl?: typeof fetch;
    scanContacts?: Array<{ userid: string; name: string }>;
    scanMode?: UnifiedDayScanMode;
    rosterStore?: ProjectViewRosterStore;
  },
): Promise<UnifiedDayCollectResult> {
  const projectViews = listProjectViewsFromConfig([org]);
  if (!projectViews.length) {
    return { poolCount: 0, scanContactCount: 0, byViewId: new Map(), errors: [] };
  }
  return collectUnifiedDayPartition({
    org,
    range,
    projectViews,
    ...deps,
  });
}
