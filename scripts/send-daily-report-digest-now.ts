#!/usr/bin/env npx tsx
/**
 * One-off manual daily-report digest send (ops). Skips the 8:30 window and daily dedup.
 * Reads config from DAILY_REPORT_DIGEST_CONFIG_FILE (does NOT require the master switch).
 *
 *   DAILY_REPORT_DIGEST_CONFIG_FILE=/path/config.json npx tsx scripts/send-daily-report-digest-now.ts
 */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import { runDailyReportDigest } from "../src/agent/daily-report-digest/daily-report-run.js";

async function main(): Promise<void> {
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    console.error("配置无效，无法发送：");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(
    `Manual daily-report digest: orgs=${config.orgs.length}, ` +
      `employees=${config.orgs.reduce((n, o) => n + o.employees.length, 0)}`,
  );

  const result = await runDailyReportDigest(config);
  console.log(
    `Done: ok=${result.ok} date=${result.labelYmd} ` +
      `submitted=${result.submittedCount} missing=${result.missingCount} errors=${result.errorCount}`,
  );
  if (!result.ok) {
    console.error(`Send failed: ${result.skipped ?? "unknown"}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
