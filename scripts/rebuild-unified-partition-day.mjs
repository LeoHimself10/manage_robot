#!/usr/bin/env node
/** Rebuild unified day partition + per-view cache for one YMD (full scan). */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.ts";
import {
  createDayPartitionCacheStore,
  loadOrCollectUnifiedDay,
} from "../src/agent/daily-report-digest/daily-report-day-partition-cache.ts";
import { createProjectViewCacheStore } from "../src/agent/daily-report-digest/daily-report-project-view-cache.ts";
import { resolveDayRangeForYmd } from "../src/agent/daily-report-digest/daily-report-window.ts";

const ymd = process.argv[2];
if (!ymd) {
  console.error("usage: rebuild-unified-partition-day.mjs YYYY-MM-DD");
  process.exit(1);
}

const { config } = loadDailyReportDigestConfig();
const org = (config.orgs ?? []).find((o) => o.label === "微光");
if (!org) {
  console.error("微光 org not found");
  process.exit(1);
}

const range = resolveDayRangeForYmd(ymd, config.timezone ?? "Asia/Shanghai", {
  cutoffHour: config.reportDayCutoffHour ?? 17,
  cutoffMinute: config.reportDayCutoffMinute ?? 0,
});

const partitionStore = createDayPartitionCacheStore();
const cacheStore = createProjectViewCacheStore();

try {
  const unified = await loadOrCollectUnifiedDay({
    org,
    range,
    refresh: true,
    scanMode: "full",
    partitionStore,
    projectViewCacheStore: cacheStore,
    ownsPartitionStore: false,
    ownsProjectViewCacheStore: false,
  });

  console.log(JSON.stringify({ date: ymd, poolCount: unified.poolCount, fromCache: unified.fromCache }, null, 2));
  for (const [viewId, digest] of unified.byViewId) {
    console.log(`${viewId}\t${digest.submitted.length}`);
  }
} finally {
  partitionStore.close();
  cacheStore.close();
}
