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
import { buildCtoRollupMorningDigestPayload, sendCtoRollupMorningDigestToUser } from "../src/agent/daily-report-digest/daily-report-cto-rollup-digest-send";
import { loadOrCollectProjectViewDigest } from "../src/agent/daily-report-digest/daily-report-project-view-digest-collect";
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

  const viewIds = allViews
    ? listProjectViewsFromConfig(config.orgs)
        .filter(isProjectViewDigestEnabledForView)
        .map((v) => v.id)
    : (() => {
        const plans = groupProjectViewDigestPlansByUser(config).get(toUserId) ?? [];
        return plans.length
          ? plans.map((p) => p.view.id)
          : listProjectViewsFromConfig(config.orgs)
              .filter((v) => v.viewers.includes(toUserId) || isProjectViewDigestEnabledForView(v))
              .map((v) => v.id);
      })();

  const uniqueViewIds = [...new Set(viewIds)];
  if (!uniqueViewIds.length) {
    console.error(`用户 ${toUserId} 没有可汇总的项目组视图`);
    process.exit(1);
  }

  const contexts = await Promise.all(
    uniqueViewIds.map((viewId) => loadOrCollectProjectViewDigest({ config, viewId, range })),
  );

  const stateStore = createProjectViewDigestStateStore();
  try {
    if (dryRun) {
      const payload = await buildCtoRollupMorningDigestPayload(contexts, range);
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
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
