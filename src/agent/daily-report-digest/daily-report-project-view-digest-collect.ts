import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import type { OrgDigest } from "./daily-report-build";
import {
  createDayPartitionCacheStore,
  loadOrCollectUnifiedDay,
  type DayPartitionCacheStore,
} from "./daily-report-day-partition-cache";
import {
  createProjectViewCacheStore,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";
import {
  parseProjectViewConfig,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import type { ReportTimeRange } from "./daily-report-window";

export interface ProjectViewDigestContext {
  view: DailyReportProjectViewConfig & { orgLabel: string };
  org: DailyReportOrgConfig;
  orgDigest: OrgDigest;
  /** @deprecated unified collect 不再使用 per-view roster；保留空数组兼容 */
  roster: Array<{ userid: string; name: string }>;
  /** 当日三类研发模板提交人数 */
  rosterCount: number;
  fromCache: boolean;
  poolCount?: number;
  scannedAt?: string;
}

export function findOrgForProjectView(
  config: DailyReportDigestConfig,
  viewId: string,
): { org: DailyReportOrgConfig; view: DailyReportProjectViewConfig & { orgLabel: string } } | undefined {
  const normalizedId = viewId.trim();
  for (const org of config.orgs) {
    for (const raw of org.projectViews ?? []) {
      const parsed = parseProjectViewConfig(raw, org.label);
      if (parsed?.id === normalizedId) {
        return { org, view: { ...parsed, orgLabel: org.label } };
      }
    }
  }
  return undefined;
}

export async function loadOrCollectProjectViewDigest(params: {
  config: DailyReportDigestConfig;
  viewId: string;
  range: ReportTimeRange;
  cacheStore?: ProjectViewCacheStore;
  partitionStore?: DayPartitionCacheStore;
  ownsCacheStore?: boolean;
  ownsPartitionStore?: boolean;
  refresh?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ProjectViewDigestContext> {
  const resolved = findOrgForProjectView(params.config, params.viewId);
  if (!resolved) {
    throw new Error(`projectView not found: ${params.viewId}`);
  }
  const { org, view } = resolved;

  const partitionStore =
    params.partitionStore ?? createDayPartitionCacheStore();
  const ownsPartitionStore = params.ownsPartitionStore ?? !params.partitionStore;
  const cacheStore =
    params.cacheStore ?? createProjectViewCacheStore();
  const ownsCacheStore = params.ownsCacheStore ?? !params.cacheStore;

  try {
    const unified = await loadOrCollectUnifiedDay({
      org,
      range: params.range,
      refresh: params.refresh,
      scanMode: "full",
      partitionStore,
      projectViewCacheStore: cacheStore,
      ownsPartitionStore: false,
      ownsProjectViewCacheStore: false,
      fetchImpl: params.fetchImpl,
    });

    const orgDigest =
      unified.byViewId.get(view.id) ?? {
        label: org.label,
        submitted: [],
        missing: [],
        onLeave: [],
        errors: unified.errors,
      };

    return {
      view,
      org,
      orgDigest,
      roster: [],
      rosterCount: unified.poolCount,
      poolCount: unified.poolCount,
      fromCache: unified.fromCache,
      scannedAt: unified.scannedAt,
    };
  } finally {
    if (ownsPartitionStore) partitionStore.close();
    if (ownsCacheStore) cacheStore.close();
  }
}
