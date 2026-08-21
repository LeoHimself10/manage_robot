#!/usr/bin/env npx tsx
/** 批量跑 projectView discovery（默认四条新产品线）。 */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import { runProjectViewDiscovery } from "../src/agent/daily-report-digest/daily-report-project-view-discovery.js";

const DEFAULT_IDS = ["cla", "oct", "laser-shockwave", "large-vessel-plaque"];

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter(Boolean);
  const viewIds = ids.length > 0 ? ids : DEFAULT_IDS;
  const { config } = loadDailyReportDigestConfig();

  for (const id of viewIds) {
    console.log(`\n[discover] ${id} ...`);
    const result = await runProjectViewDiscovery(id, config);
    console.log(
      `[ok] ${id}: added=${result.added}, totalRoster=${result.totalRoster}, scanned=${result.discovered.length}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
