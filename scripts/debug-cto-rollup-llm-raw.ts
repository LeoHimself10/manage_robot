#!/usr/bin/env npx tsx
/**
 * 调试 CTO 合并早报 plain text LLM 原始输出。
 *
 * Usage:
 *   npx tsx scripts/debug-cto-rollup-llm-raw.ts --view=semiconductor-vein --date=2026-06-22
 */
import "dotenv/config";
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config";
import { loadOrCollectProjectViewDigest } from "../src/agent/daily-report-digest/daily-report-project-view-digest-collect";
import {
  loadDailyReportMorningLlmConfig,
  summarizeProjectViewMorningOverviewPlainText,
  fallbackCtoRollupOverviewSummary,
} from "../src/agent/daily-report-digest/daily-report-project-view-morning-llm";
import { resolveDayRangeForYmd, resolveReportRange } from "../src/agent/daily-report-digest/daily-report-window";

function parseArgs(): { viewId: string; dateYmd?: string } {
  let viewId = "semiconductor-vein";
  let dateYmd: string | undefined;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--view=")) viewId = arg.slice("--view=".length).trim() || viewId;
    else if (arg.startsWith("--date=")) dateYmd = arg.slice("--date=".length).trim() || undefined;
  }
  return { viewId, dateYmd };
}

async function main(): Promise<void> {
  const { viewId, dateYmd } = parseArgs();
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length) {
    console.error(errors.join("; "));
    process.exit(1);
  }

  const range = dateYmd
    ? resolveDayRangeForYmd(dateYmd, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      })
    : resolveReportRange(new Date(), config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });

  const ctx = await loadOrCollectProjectViewDigest({ config, viewId, range });
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;
  const llmConfig = loadDailyReportMorningLlmConfig();

  console.log("view:", ctx.view.label, viewId);
  console.log("date:", range.labelYmd);
  console.log("submitted:", ctx.orgDigest.submitted.length, "/", ctx.rosterCount);

  if (!llmConfig?.enabled) {
    const fb = fallbackCtoRollupOverviewSummary(
      ctx.view.label,
      ctx.rosterCount,
      ctx.orgDigest,
    );
    console.log("\n[fallback - LLM disabled]\n", fb.overview);
    return;
  }

  const overview = await summarizeProjectViewMorningOverviewPlainText(
    ctx.view.label,
    dateLabel,
    ctx.rosterCount,
    ctx.orgDigest,
    llmConfig,
  );

  console.log("\n[plain text overview]\n", overview ?? "(null → would fallback)");
  if (!overview) {
    const fb = fallbackCtoRollupOverviewSummary(
      ctx.view.label,
      ctx.rosterCount,
      ctx.orgDigest,
    );
    console.log("\n[fallback]\n", fb.overview);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
