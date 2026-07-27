import { logStructured } from "../../infra/logger";
import { getLocalTimeParts } from "../reminders/reminder-policy";
import {
  loadDailyReportDigestConfig,
  type DailyReportDigestConfig,
} from "./daily-report-config";
import { buildCtoRollupDigestForDay } from "./daily-report-cto-rollup-build";
import { evaluateCtoRollupDigestQuality } from "./daily-report-cto-rollup-digest-send";
import { isCtoRollupDigestEnabled } from "./daily-report-cto-rollup-digest-flag";
import { sendCtoRollupMorningDigestToUser } from "./daily-report-cto-rollup-digest-send";
import { loadOrCollectProjectViewDigest } from "./daily-report-project-view-digest-collect";
import {
  isDailyReportProjectViewDigestEnabled,
  parseProjectViewDigestExcludeUserIdsFromEnv,
} from "./daily-report-project-view-digest-flag";
import {
  createProjectViewCacheStore,
  type ProjectViewCacheStore,
} from "./daily-report-project-view-cache";
import {
  createProjectViewDigestStateStore,
  type ProjectViewDigestStateStore,
} from "./daily-report-project-view-digest-state";
import { sendProjectViewMorningDigestToUser } from "./daily-report-project-view-digest-send";
import type { ProjectViewDigestContext } from "./daily-report-project-view-digest-collect";
import { isDailyReportProjectViewsEnabled } from "./daily-report-project-view-flag";
import {
  groupProjectViewDigestPlansByUser,
  isProjectViewDigestEnabledForView,
  listProjectViewsFromConfig,
  resolveProjectViewDigestRecipients,
} from "./daily-report-project-views";
import { resolveReportRange } from "./daily-report-window";

const DEFAULT_SEND_HOUR = 8;
const DEFAULT_SEND_MINUTE = 0;
const SEND_WINDOW_MINUTES = 5;

/** 合并卡片也必须按收件人的订阅范围裁剪，不能把其它项目顺带发给单项目接收人。 */
export function selectProjectViewContextsForDigestRecipient(
  contexts: ProjectViewDigestContext[],
  viewIds: Iterable<string>,
): ProjectViewDigestContext[] {
  const allowed = new Set(viewIds);
  return contexts.filter((ctx) => allowed.has(ctx.view.id));
}

export interface DailyReportProjectViewDigestSchedulerDeps {
  config?: DailyReportDigestConfig;
  stateStore?: ProjectViewDigestStateStore;
  cacheStore?: ProjectViewCacheStore;
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
  const cacheStore = deps?.cacheStore ?? createProjectViewCacheStore();
  const ownsCacheStore = !deps?.cacheStore;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  let timer: NodeJS.Timeout | undefined;
  let sending = false;

  async function runRollupDigestSend(
    now: Date,
    config: DailyReportDigestConfig,
    range: ReturnType<typeof resolveReportRange>,
    envExclude: string[],
  ): Promise<void> {
    const plansByUser = groupProjectViewDigestPlansByUser(config, envExclude);
    const usersInWindow: string[] = [];

    for (const [userId, plans] of plansByUser) {
      const inWindow = plans.some((plan) =>
        isProjectViewDigestSendWindow(now, config, plan.sendHour, plan.sendMinute),
      );
      if (inWindow) usersInWindow.push(userId);
    }
    if (!usersInWindow.length) return;

    const digestViews = listProjectViewsFromConfig(config.orgs).filter(
      isProjectViewDigestEnabledForView,
    );
    const viewIdsNeeded = new Set(digestViews.map((v) => v.id));

    const built = await buildCtoRollupDigestForDay({
      config,
      range,
      viewIds: [...viewIdsNeeded],
      cacheStore,
      fetchImpl,
    });
    for (const userId of usersInWindow) {
      try {
        const plans = plansByUser.get(userId) ?? [];
        const contexts = selectProjectViewContextsForDigestRecipient(
          built.contexts,
          plans.map((plan) => plan.view.id),
        );
        const quality = evaluateCtoRollupDigestQuality(contexts);
        if (!quality.ok) {
          logStructured({
            event: "daily_report_cto_rollup_digest_quality_failed",
            dateYmd: range.labelYmd,
            userId,
            reasons: quality.reasons,
            errorCount: quality.errorCount,
          });
          continue;
        }

        // 单项目接收人使用项目卡：含逐人事项、工时、项目进展和该项目工作台深链。
        if (contexts.length === 1) {
          await sendProjectViewMorningDigestToUser({
            ctx: contexts[0]!,
            range,
            userId,
            stateStore,
            fetchImpl,
          });
        } else {
          await sendCtoRollupMorningDigestToUser({
            contexts,
            range,
            userId,
            stateStore,
            fetchImpl,
            overviewByViewId: built.overviewByViewId,
            cacheStore,
          });
        }
      } catch (err) {
        logStructured({
          event: "daily_report_cto_rollup_digest_send_failed",
          dateYmd: range.labelYmd,
          userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logStructured({
      event: "daily_report_project_view_digest_scheduler_done",
      labelYmd: range.labelYmd,
      mode: "cto_rollup",
      userCount: usersInWindow.length,
      viewCount: viewIdsNeeded.size,
    });
  }

  async function runLegacyPerViewDigestSend(
    now: Date,
    config: DailyReportDigestConfig,
    range: ReturnType<typeof resolveReportRange>,
    envExclude: string[],
  ): Promise<void> {
    const views = listProjectViewsFromConfig(config.orgs).filter(isProjectViewDigestEnabledForView);
    const inWindowViews = views.filter((view) => {
      const hour = view.digest?.sendHour ?? DEFAULT_SEND_HOUR;
      const minute = view.digest?.sendMinute ?? DEFAULT_SEND_MINUTE;
      return isProjectViewDigestSendWindow(now, config, hour, minute);
    });
    if (!inWindowViews.length) return;

    for (const view of inWindowViews) {
      const recipients = resolveProjectViewDigestRecipients(view, envExclude);
      if (!recipients.length) continue;

      const ctx = await loadOrCollectProjectViewDigest({
        config,
        viewId: view.id,
        range,
        cacheStore,
        ownsCacheStore: false,
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
      mode: "per_view",
      viewCount: inWindowViews.length,
    });
  }

  async function runDigestSend(now: Date = new Date()): Promise<void> {
    if (sending) return;
    if (!isDailyReportProjectViewsEnabled()) return;
    if (!isDailyReportProjectViewDigestEnabled()) return;

    const config = loadConfig();
    const views = listProjectViewsFromConfig(config.orgs).filter(isProjectViewDigestEnabledForView);
    if (!views.length) return;

    const envExclude = parseProjectViewDigestExcludeUserIdsFromEnv();
    const anyInWindow = isCtoRollupDigestEnabled()
      ? [...groupProjectViewDigestPlansByUser(config, envExclude).values()].some((plans) =>
          plans.some((plan) =>
            isProjectViewDigestSendWindow(now, config, plan.sendHour, plan.sendMinute),
          ),
        )
      : views.some((view) => {
          const hour = view.digest?.sendHour ?? DEFAULT_SEND_HOUR;
          const minute = view.digest?.sendMinute ?? DEFAULT_SEND_MINUTE;
          return isProjectViewDigestSendWindow(now, config, hour, minute);
        });

    if (!anyInWindow) return;

    sending = true;
    try {
      const range = resolveReportRange(now, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });

      if (isCtoRollupDigestEnabled()) {
        await runRollupDigestSend(now, config, range, envExclude);
      } else {
        await runLegacyPerViewDigestSend(now, config, range, envExclude);
      }
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
    if (ownsCacheStore) cacheStore.close();
  }

  return {
    runDigestSend,
    startIntervalLoop,
    stopIntervalLoop,
    close,
  };
}
