import { logStructured } from "../../infra/logger";
import { getLocalTimeParts } from "../reminders/reminder-policy";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "./daily-report-config";
import { loadOrCollectProjectViewDigest } from "./daily-report-project-view-digest-collect";
import {
  isDailyReportProjectViewDigestEnabled,
  parseProjectViewDigestExcludeUserIdsFromEnv,
} from "./daily-report-project-view-digest-flag";
import {
  createProjectViewDigestStateStore,
  type ProjectViewDigestStateStore,
} from "./daily-report-project-view-digest-state";
import { sendProjectViewMorningDigestToUser } from "./daily-report-project-view-digest-send";
import { isDailyReportProjectViewsEnabled } from "./daily-report-project-view-flag";
import {
  isProjectViewDigestEnabledForView,
  listProjectViewsFromConfig,
  resolveProjectViewDigestRecipients,
} from "./daily-report-project-views";
import { resolveReportRange } from "./daily-report-window";

const DEFAULT_SEND_HOUR = 8;
const DEFAULT_SEND_MINUTE = 0;
const SEND_WINDOW_MINUTES = 5;

export interface DailyReportProjectViewDigestSchedulerDeps {
  config?: DailyReportDigestConfig;
  stateStore?: ProjectViewDigestStateStore;
  fetchImpl?: typeof fetch;
}

export function isProjectViewDigestSendWindow(
  now: Date,
  config: Pick<DailyReportDigestConfig, "timezone">,
  sendHour = DEFAULT_SEND_HOUR,
  sendMinute = DEFAULT_SEND_MINUTE,
): boolean {
  const { weekday, hour, minute } = getLocalTimeParts(now, config.timezone);
  if (weekday === 0 || weekday === 1) return false;
  if (hour !== sendHour) return false;
  return minute >= sendMinute && minute < sendMinute + SEND_WINDOW_MINUTES;
}

export function createDailyReportProjectViewDigestScheduler(
  deps?: DailyReportProjectViewDigestSchedulerDeps,
) {
  const loadConfig = () => deps?.config ?? loadDailyReportDigestConfig().config;
  const stateStore = deps?.stateStore ?? createProjectViewDigestStateStore();
  const ownsStateStore = !deps?.stateStore;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let timer: NodeJS.Timeout | undefined;
  let sending = false;

  async function runDigestSend(now: Date = new Date()): Promise<void> {
    if (sending) return;
    if (!isDailyReportProjectViewsEnabled()) return;
    if (!isDailyReportProjectViewDigestEnabled()) return;

    const config = loadConfig();
    const views = listProjectViewsFromConfig(config.orgs).filter(isProjectViewDigestEnabledForView);
    if (!views.length) return;

    const envExclude = parseProjectViewDigestExcludeUserIdsFromEnv();
    const inWindowViews = views.filter((view) => {
      const hour = view.digest?.sendHour ?? DEFAULT_SEND_HOUR;
      const minute = view.digest?.sendMinute ?? DEFAULT_SEND_MINUTE;
      return isProjectViewDigestSendWindow(now, config, hour, minute);
    });
    if (!inWindowViews.length) return;

    sending = true;
    try {
      const range = resolveReportRange(now, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });

      for (const view of inWindowViews) {
        const recipients = resolveProjectViewDigestRecipients(view, envExclude);
        if (!recipients.length) continue;

        const ctx = await loadOrCollectProjectViewDigest({
          config,
          viewId: view.id,
          range,
        });

        for (const userId of recipients) {
          try {
            await sendProjectViewMorningDigestToUser({
              ctx,
              range,
              userId,
              stateStore,
              fetchImpl,
            });
          } catch (err) {
            logStructured({
              event: "daily_report_project_view_digest_send_failed",
              viewId: view.id,
              dateYmd: range.labelYmd,
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      logStructured({
        event: "daily_report_project_view_digest_scheduler_done",
        labelYmd: range.labelYmd,
        viewCount: inWindowViews.length,
      });
    } catch (err) {
      logStructured({
        event: "daily_report_project_view_digest_scheduler_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      sending = false;
    }
  }

  function startIntervalLoop(): void {
    if (!isDailyReportProjectViewsEnabled()) return;
    if (!isDailyReportProjectViewDigestEnabled()) return;
    const config = loadConfig();
    if (!listProjectViewsFromConfig(config.orgs).some(isProjectViewDigestEnabledForView)) return;
    if (timer) return;
    void runDigestSend().catch(() => undefined);
    timer = setInterval(() => {
      void runDigestSend().catch(() => undefined);
    }, config.scanIntervalMs);
  }

  function stopIntervalLoop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  function close(): void {
    stopIntervalLoop();
    if (ownsStateStore) stateStore.close();
  }

  return {
    runDigestSend,
    startIntervalLoop,
    stopIntervalLoop,
    close,
  };
}
