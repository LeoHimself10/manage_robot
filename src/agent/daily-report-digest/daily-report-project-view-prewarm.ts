import { logStructured } from "../../infra/logger";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "./daily-report-config";
import { collectProjectViewDigestForRange } from "./daily-report-project-view-collect";
import { runProjectViewDiscovery } from "./daily-report-project-view-discovery";
import {
  createProjectViewCacheStore,
  putProjectViewCache,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";
import { ensureProjectViewPersonBriefs } from "./daily-report-project-view-person-briefs";
import { ensureProjectViewCtoOverview } from "./daily-report-project-view-summaries";
import {
  createProjectViewRosterStore,
  listProjectViewRoster,
  type ProjectViewRosterStore,
} from "./daily-report-project-view-roster-store";
import {
  isProjectViewDigestEnabledForView,
  listProjectViewsFromConfig,
} from "./daily-report-project-views";
import { resolveReportRange } from "./daily-report-window";
import { getLocalTimeParts } from "../reminders/reminder-policy";
import { isDailyReportProjectViewsEnabled } from "./daily-report-project-view-flag";

function envInt(name: string, defaultValue: number): number {
  const n = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function readPrewarmHour(): number {
  return envInt("DAILY_REPORT_PROJECT_VIEW_PREWARM_HOUR", 6);
}

function readPrewarmMinute(): number {
  return envInt("DAILY_REPORT_PROJECT_VIEW_PREWARM_MINUTE", 45);
}

const PREWARM_WINDOW_MINUTES = 5;

export interface DailyReportProjectViewPrewarmDeps {
  config?: DailyReportDigestConfig;
  rosterStore?: ProjectViewRosterStore;
  cacheStore?: ProjectViewCacheStore;
  fetchImpl?: typeof fetch;
  runDiscovery?: typeof runProjectViewDiscovery;
  collectDigest?: typeof collectProjectViewDigestForRange;
  prewarmSummaries?: boolean;
}

export function isProjectViewPrewarmWindow(
  now: Date,
  config: Pick<DailyReportDigestConfig, "timezone">,
): boolean {
  const { weekday, hour, minute } = getLocalTimeParts(now, config.timezone);
  if (weekday === 0 || weekday === 1) return false;
  const prewarmHour = readPrewarmHour();
  const prewarmMinute = readPrewarmMinute();
  if (hour !== prewarmHour) return false;
  return minute >= prewarmMinute && minute < prewarmMinute + PREWARM_WINDOW_MINUTES;
}

function envPrewarmSummariesEnabled(): boolean {
  const raw = String(process.env.DAILY_REPORT_PROJECT_VIEW_PREWARM_SUMMARIES ?? "1")
    .trim()
    .toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export function createDailyReportProjectViewPrewarmScheduler(
  deps?: DailyReportProjectViewPrewarmDeps,
) {
  const loadConfig = () => deps?.config ?? loadDailyReportDigestConfig().config;
  const rosterStore = deps?.rosterStore ?? createProjectViewRosterStore();
  const cacheStore = deps?.cacheStore ?? createProjectViewCacheStore();
  const ownsRosterStore = !deps?.rosterStore;
  const ownsCacheStore = !deps?.cacheStore;
  const runDiscovery = deps?.runDiscovery ?? runProjectViewDiscovery;
  const collectDigest = deps?.collectDigest ?? collectProjectViewDigestForRange;
  const prewarmSummaries = deps?.prewarmSummaries ?? envPrewarmSummariesEnabled();
  let timer: NodeJS.Timeout | undefined;
  let scanning = false;

  async function runPrewarm(now: Date = new Date()): Promise<void> {
    if (scanning) return;
    if (!isDailyReportProjectViewsEnabled()) return;
    const config = loadConfig();
    const views = listProjectViewsFromConfig(config.orgs);
    if (!views.length) return;
    if (!isProjectViewPrewarmWindow(now, config)) return;

    scanning = true;
    try {
      const range = resolveReportRange(now, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });
      const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;

      for (const view of views) {
        const org = config.orgs.find((o) => o.label === view.orgLabel);
        if (!org) continue;

        let roster = listProjectViewRoster(view.id, rosterStore);
        if (!roster.length) {
          await runDiscovery(view.id, config, {
            fetchImpl: deps?.fetchImpl,
            rosterStore,
            now,
          });
          roster = listProjectViewRoster(view.id, rosterStore);
        }

        const digest = await collectDigest(org, view, range, roster, {
          fetchImpl: deps?.fetchImpl,
        });
        putProjectViewCache(
          view.id,
          range.labelYmd,
          { submitted: digest.submitted, errors: digest.errors },
          cacheStore,
        );

        if (prewarmSummaries && isProjectViewDigestEnabledForView(view)) {
          await ensureProjectViewCtoOverview({
            viewId: view.id,
            viewLabel: view.label,
            dateYmd: range.labelYmd,
            dateLabel,
            rosterCount: roster.length,
            orgDigest: digest,
            cacheStore,
            fetchImpl: deps?.fetchImpl,
          });
        }

        if (prewarmSummaries && digest.submitted.length > 0) {
          await ensureProjectViewPersonBriefs({
            viewId: view.id,
            viewLabel: view.label,
            dateYmd: range.labelYmd,
            dateLabel,
            rosterCount: roster.length,
            orgDigest: digest,
            cacheStore,
            fetchImpl: deps?.fetchImpl,
          });
        }
      }
      logStructured({
        event: "daily_report_project_view_prewarm_done",
        labelYmd: range.labelYmd,
        viewCount: views.length,
        prewarmSummaries,
      });
    } catch (err) {
      logStructured({
        event: "daily_report_project_view_prewarm_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      scanning = false;
    }
  }

  async function bootstrapOnStartup(): Promise<void> {
    if (!isDailyReportProjectViewsEnabled()) return;
    const config = loadConfig();
    const views = listProjectViewsFromConfig(config.orgs);
    if (!views.length) return;

    for (const view of views) {
      const roster = listProjectViewRoster(view.id, rosterStore);
      if (roster.length > 0) continue;
      void runDiscovery(view.id, config, {
        fetchImpl: deps?.fetchImpl,
        rosterStore,
      }).catch((err) => {
        logStructured({
          event: "daily_report_project_view_bootstrap_discovery_failed",
          viewId: view.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  function startIntervalLoop(): void {
    if (!isDailyReportProjectViewsEnabled()) return;
    const config = loadConfig();
    if (!listProjectViewsFromConfig(config.orgs).length) return;
    if (timer) return;
    void runPrewarm().catch(() => undefined);
    timer = setInterval(() => {
      void runPrewarm().catch(() => undefined);
    }, config.scanIntervalMs);
  }

  function stopIntervalLoop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  function close(): void {
    stopIntervalLoop();
    if (ownsRosterStore) rosterStore.close();
    if (ownsCacheStore) cacheStore.close();
  }

  return {
    runPrewarm,
    bootstrapOnStartup,
    startIntervalLoop,
    stopIntervalLoop,
    close,
  };
}
