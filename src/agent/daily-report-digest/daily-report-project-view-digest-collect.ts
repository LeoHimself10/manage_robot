import type { DailyReportDigestConfig, DailyReportOrgConfig } from "./daily-report-config";
import type { OrgDigest } from "./daily-report-build";
import { collectProjectViewDigestForRange } from "./daily-report-project-view-collect";
import {
  createProjectViewCacheStore,
  getProjectViewCache,
  putProjectViewCache,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";
import {
  createProjectViewRosterStore,
  listProjectViewRoster,
  type ProjectViewRosterMember,
  type ProjectViewRosterStore,
} from "./daily-report-project-view-roster-store";
import {
  parseProjectViewConfig,
  type DailyReportProjectViewConfig,
} from "./daily-report-project-views";
import type { ReportTimeRange } from "./daily-report-window";

export interface ProjectViewDigestContext {
  view: DailyReportProjectViewConfig & { orgLabel: string };
  org: DailyReportOrgConfig;
  orgDigest: OrgDigest;
  roster: ProjectViewRosterMember[];
  rosterCount: number;
  fromCache: boolean;
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
  rosterStore?: ProjectViewRosterStore;
  ownsCacheStore?: boolean;
  ownsRosterStore?: boolean;
}): Promise<ProjectViewDigestContext> {
  const resolved = findOrgForProjectView(params.config, params.viewId);
  if (!resolved) {
    throw new Error(`projectView not found: ${params.viewId}`);
  }
  const { org, view } = resolved;

  const rosterStore =
    params.rosterStore ?? createProjectViewRosterStore();
  const ownsRosterStore = params.ownsRosterStore ?? !params.rosterStore;
  const cacheStore =
    params.cacheStore ?? createProjectViewCacheStore();
  const ownsCacheStore = params.ownsCacheStore ?? !params.cacheStore;

  try {
    const roster = listProjectViewRoster(view.id, rosterStore);
    const cached = getProjectViewCache(view.id, params.range.labelYmd, cacheStore);

    let orgDigest: OrgDigest;
    let fromCache = false;

    if (cached) {
      orgDigest = {
        label: org.label,
        submitted: cached.payload.submitted,
        missing: [],
        onLeave: [],
        errors: cached.payload.errors,
      };
      fromCache = true;
    } else {
      orgDigest = await collectProjectViewDigestForRange(
        org,
        view,
        params.range,
        roster,
      );
      putProjectViewCache(
        view.id,
        params.range.labelYmd,
        { submitted: orgDigest.submitted, errors: orgDigest.errors },
        cacheStore,
      );
    }

    return {
      view,
      org,
      orgDigest,
      roster,
      rosterCount: roster.length,
      fromCache,
    };
  } finally {
    if (ownsRosterStore) rosterStore.close();
    if (ownsCacheStore) cacheStore.close();
  }
}
