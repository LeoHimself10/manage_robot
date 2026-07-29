import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import {
  createDayPartitionCacheStore,
  loadOrCollectUnifiedDay,
  type DayPartitionCacheStore,
} from "./daily-report-day-partition-cache";
import {
  evaluateCtoRollupDigestQuality,
  type CtoRollupDigestQuality,
} from "./daily-report-cto-rollup-digest-send";
import type { OrgDigest } from "./daily-report-build";
import type { ProjectViewDigestContext } from "./daily-report-project-view-digest-collect";
import {
  createProjectViewCacheStore,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";
import { ensureProjectViewCtoOverview } from "./daily-report-project-view-summaries";
import {
  listProjectViewsFromConfig,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import type { ReportTimeRange } from "./daily-report-window";

export interface CtoRollupDigestBuildResult {
  contexts: ProjectViewDigestContext[];
  overviewByViewId: Map<string, string>;
  quality: CtoRollupDigestQuality;
}

type ProjectViewWithOrg = DailyReportProjectViewConfig & { orgLabel: string };

function emptyDigest(orgLabel: string, errors: OrgDigest["errors"]): OrgDigest {
  return {
    label: orgLabel,
    submitted: [],
    missing: [],
    onLeave: [],
    errors,
  };
}

function findOrg(config: DailyReportDigestConfig, orgLabel: string): DailyReportOrgConfig {
  const org = config.orgs.find((item) => item.label === orgLabel);
  if (!org) throw new Error(`org not found for project views: ${orgLabel}`);
  return org;
}

function groupViewsByOrg(
  config: DailyReportDigestConfig,
  viewIds: string[],
): Map<string, ProjectViewWithOrg[]> {
  const allViews = listProjectViewsFromConfig(config.orgs);
  const byId = new Map(allViews.map((view) => [view.id, view]));
  const grouped = new Map<string, ProjectViewWithOrg[]>();

  for (const viewId of [...new Set(viewIds.map((id) => id.trim()).filter(Boolean))]) {
    const view = byId.get(viewId);
    if (!view) throw new Error(`projectView not found: ${viewId}`);
    const existing = grouped.get(view.orgLabel) ?? [];
    existing.push(view);
    grouped.set(view.orgLabel, existing);
  }

  return grouped;
}

export async function buildCtoRollupDigestForDay(params: {
  config: DailyReportDigestConfig;
  range: ReportTimeRange;
  viewIds: string[];
  partitionStore?: DayPartitionCacheStore;
  cacheStore?: ProjectViewCacheStore;
  fetchImpl?: typeof fetch;
  precomputeOverviews?: boolean;
}): Promise<CtoRollupDigestBuildResult> {
  const partitionStore = params.partitionStore ?? createDayPartitionCacheStore();
  const cacheStore = params.cacheStore ?? createProjectViewCacheStore();
  const ownsPartitionStore = !params.partitionStore;
  const ownsCacheStore = !params.cacheStore;
  const contexts: ProjectViewDigestContext[] = [];
  const overviewByViewId = new Map<string, string>();
  const precomputeOverviews = params.precomputeOverviews ?? true;
  const dateLabel = `${params.range.labelDisplay} (${params.range.labelYmd})`;

  try {
    for (const [orgLabel, views] of groupViewsByOrg(params.config, params.viewIds)) {
      const org = findOrg(params.config, orgLabel);
      const unified = await loadOrCollectUnifiedDay({
        org,
        range: params.range,
        // A sent digest must always be built from a complete org scan. If an
        // operator has cleared the partition cache, never fall back to the
        // workbench's roster-only fast scan.
        scanMode: "full",
        partitionStore,
        projectViewCacheStore: cacheStore,
        ownsPartitionStore: false,
        ownsProjectViewCacheStore: false,
        fetchImpl: params.fetchImpl,
      });

      for (const view of views) {
        const orgDigest = unified.byViewId.get(view.id) ?? emptyDigest(org.label, unified.errors);
        const ctx: ProjectViewDigestContext = {
          view,
          org,
          orgDigest,
          roster: [],
          rosterCount: unified.poolCount,
          poolCount: unified.poolCount,
          fromCache: unified.fromCache,
          scannedAt: unified.scannedAt,
          collectErrors: unified.errors,
          scanContactCount: unified.scanContactCount,
        };
        contexts.push(ctx);

        if (precomputeOverviews) {
          const overview = await ensureProjectViewCtoOverview({
            viewId: view.id,
            viewLabel: view.label,
            dateYmd: params.range.labelYmd,
            dateLabel,
            rosterCount: unified.poolCount,
            orgDigest,
            cacheStore,
            fetchImpl: params.fetchImpl,
          });
          overviewByViewId.set(view.id, overview);
        }
      }
    }

    return {
      contexts,
      overviewByViewId,
      quality: evaluateCtoRollupDigestQuality(contexts),
    };
  } finally {
    if (ownsPartitionStore) partitionStore.close();
    if (ownsCacheStore) cacheStore.close();
  }
}
