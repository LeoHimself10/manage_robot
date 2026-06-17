#!/usr/bin/env npx tsx
/**
 * 微光 projectView 项目组早报：LLM 综述 + 按人摘要 + 工作台深链，1:1 机器人私发。
 *
 * Usage:
 *   npx tsx scripts/send-project-view-morning-digest.ts --view=semiconductor-vein
 *   npx tsx scripts/send-project-view-morning-digest.ts --view=semiconductor-vein --dry-run
 */
import "dotenv/config";
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config";
import { loadOrCollectProjectViewDigest } from "../src/agent/daily-report-digest/daily-report-project-view-digest-collect";
import {
  createProjectViewDigestStateStore,
} from "../src/agent/daily-report-digest/daily-report-project-view-digest-state";
import {
  buildProjectViewMorningDigestPayload,
  sendProjectViewMorningDigestToUser,
} from "../src/agent/daily-report-digest/daily-report-project-view-digest-send";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../src/agent/daily-report-digest/daily-report-window";

/** 姚凯珩（微光 managebot）；明思 mingsibot 为 652949075622784820 */
const DEFAULT_TO_USER_ID = "641871342";
const DEFAULT_VIEW_ID = "semiconductor-vein";

function parseArgs(): {
  viewId: string;
  toUserId: string;
  dateYmd?: string;
  dryRun: boolean;
} {
  let viewId = DEFAULT_VIEW_ID;
  let toUserId = DEFAULT_TO_USER_ID;
  let dateYmd: string | undefined;
  let dryRun = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--view=")) viewId = arg.slice("--view=".length).trim() || DEFAULT_VIEW_ID;
    else if (arg.startsWith("--to=")) toUserId = arg.slice("--to=".length).trim() || DEFAULT_TO_USER_ID;
    else if (arg.startsWith("--date=")) dateYmd = arg.slice("--date=".length).trim() || undefined;
  }

  return { viewId, toUserId, dateYmd, dryRun };
}

async function main(): Promise<void> {
  const { viewId, toUserId, dateYmd, dryRun } = parseArgs();

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

  const ctx = await loadOrCollectProjectViewDigest({ config, viewId, range });
  const stateStore = createProjectViewDigestStateStore();

  try {
    if (dryRun) {
      const payload = await buildProjectViewMorningDigestPayload(ctx, range);
      console.log(
        JSON.stringify(
          {
            ok: true,
            dryRun: true,
            viewId,
            viewLabel: ctx.view.label,
            date: range.labelYmd,
            toUserId,
            rosterCount: ctx.rosterCount,
            submittedCount: payload.submittedCount,
            fromCache: ctx.fromCache,
            errorCount: ctx.orgDigest.errors.length,
            markdown: payload.markdown,
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await sendProjectViewMorningDigestToUser({
      ctx,
      range,
      userId: toUserId,
      stateStore,
      previewTitleSuffix: "预览（私发）",
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: false,
          toUserId,
          viewId,
          viewLabel: ctx.view.label,
          date: range.labelYmd,
          rosterCount: result.rosterCount,
          submittedCount: result.submittedCount,
          fromCache: ctx.fromCache,
          errorCount: ctx.orgDigest.errors.length,
          robotMessageKey: result.robotMessageKey,
          skipped: result.skipped ?? false,
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
