#!/usr/bin/env npx tsx
/**
 * 微光 CTO 合并项目组早报：一条消息汇总全部 projectView。
 *
 * Usage:
 *   npx tsx scripts/send-cto-rollup-morning-digest.ts --to=01451725613871 --dry-run
 *   npx tsx scripts/send-cto-rollup-morning-digest.ts --to=641871342
 *   npx tsx scripts/send-cto-rollup-morning-digest.ts --to=641871342 --date=2026-06-18 --all-views --preview
 */
import "dotenv/config";
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config";
import {
  buildCtoRollupMorningDigestPayload,
  sendCtoRollupMorningDigestToUser,
} from "../src/agent/daily-report-digest/daily-report-cto-rollup-digest-send";
import { buildCtoRollupDigestForDay } from "../src/agent/daily-report-digest/daily-report-cto-rollup-build";
import { createProjectViewCacheStore } from "../src/agent/daily-report-digest/daily-report-project-view-cache";
import { createProjectViewDigestStateStore } from "../src/agent/daily-report-digest/daily-report-project-view-digest-state";
import {
  groupProjectViewDigestPlansByUser,
  isProjectViewDigestEnabledForView,
  listProjectViewsFromConfig,
} from "../src/agent/daily-report-digest/daily-report-project-views";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../src/agent/daily-report-digest/daily-report-window";

const DEFAULT_TO_USER_ID = "641871342";

function parseArgs(): {
  toUserId: string;
  dateYmd?: string;
  dryRun: boolean;
  allViews: boolean;
  preview: boolean;
} {
  let toUserId = DEFAULT_TO_USER_ID;
  let dateYmd: string | undefined;
  let dryRun = false;
  let allViews = false;
  let preview = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--all-views") allViews = true;
    else if (arg === "--preview") preview = true;
    else if (arg.startsWith("--to=")) toUserId = arg.slice("--to=".length).trim() || DEFAULT_TO_USER_ID;
    else if (arg.startsWith("--date=")) dateYmd = arg.slice("--date=".length).trim() || undefined;
  }

  return { toUserId, dateYmd, dryRun, allViews, preview };
}

async function main(): Promise<void> {
  const { toUserId, dateYmd, dryRun, allViews, preview } = parseArgs();
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    console.error("配置无效：", errors.join("；"));
    process.exit(1);
  }

  const now = new Date();
  const range = dateYmd
    ? resolveDayRangeForYmd(dateYmd, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      })
    : resolveReportRange(now, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });

  const digestViews = listProjectViewsFromConfig(config.orgs).filter(
    isProjectViewDigestEnabledForView,
  );
  const viewIds = allViews
    ? digestViews.map((v) => v.id)
    : (() => {
        const plans = groupProjectViewDigestPlansByUser(config).get(toUserId) ?? [];
        return plans.length
          ? plans.map((p) => p.view.id)
          : digestViews.filter((v) => v.viewers.includes(toUserId)).map((v) => v.id);
      })();

  const uniqueViewIds = [...new Set(viewIds)];
  if (!uniqueViewIds.length) {
    console.error(`用户 ${toUserId} 没有可汇总的项目组视图`);
    process.exit(1);
  }

  const cacheStore = createProjectViewCacheStore();
  const built = await buildCtoRollupDigestForDay({
    config,
    range,
    viewIds: uniqueViewIds,
    cacheStore,
  });
  if (!built.quality.ok) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "cto_rollup_quality_failed",
          date: range.labelYmd,
          viewIds: uniqueViewIds,
          reasons: built.quality.reasons,
          errorCount: built.quality.errorCount,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  const contexts = built.contexts;
  const overviewByViewId = built.overviewByViewId;

  const stateStore = createProjectViewDigestStateStore();
  try {
    if (dryRun) {
      const payload = await buildCtoRollupMorningDigestPayload(contexts, range, fetch, {
        overviewByViewId,
        cacheStore,
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            toUserId,
            date: range.labelYmd,
            viewIds: uniqueViewIds,
            projectLines: payload.projectLines,
            markdown: payload.markdown,
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await sendCtoRollupMorningDigestToUser({
      contexts,
      range,
      userId: toUserId,
      stateStore,
      skipStateDedup: preview,
      previewTitleSuffix: preview ? "预览" : undefined,
      overviewByViewId,
      cacheStore,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: false,
          toUserId,
          date: range.labelYmd,
          viewIds: uniqueViewIds,
          skipped: result.skipped ?? false,
          robotMessageKey: result.robotMessageKey,
        },
        null,
        2,
      ),
    );
  } finally {
    stateStore.close();
    cacheStore.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
