#!/usr/bin/env npx tsx
/**
 * 微光 org 四条产品线字段探测：扫描近 N 天日报，统计 CLA/OCT/激光冲击波/大血管斑块减容 命中情况。
 *
 * 用法:
 *   npx tsx scripts/probe-weiguang-product-line-fields.ts [--days=30] [--max-contacts=200] [--out=path.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import { listOrgScanContacts } from "../src/agent/daily-report-digest/daily-report-org-scan-contacts.js";
import {
  analyzeReportsForProductLineProbe,
  type ProductLineProbeResult,
} from "../src/agent/daily-report-digest/daily-report-product-line-probe.js";
import {
  DEFAULT_PROJECT_VIEW_DISCOVERY_DAYS,
  mapWithConcurrency,
  resolveDiscoveryTimeRange,
  scanConcurrencyLimit,
} from "../src/agent/daily-report-digest/daily-report-project-view-discovery.js";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function printSummary(result: ProductLineProbeResult): void {
  console.log("\n=== 微光产品线字段探测 ===");
  console.log(`扫描联系人: ${result.scannedContactCount}，日志条数: ${result.scannedReportCount}`);
  console.log(`生成时间: ${result.generatedAt}\n`);

  for (const kw of result.keywords) {
    console.log(`--- ${kw.label} (${kw.id}) needle="${kw.needle}" ---`);
    console.log(`  命中日志: ${kw.hitReportCount}，涉及人员: ${kw.hitUserCount}`);
    if (kw.userids.length) console.log(`  userids: ${kw.userids.join(", ")}`);
    console.log(
      `  字段分布: workModule=${kw.fieldKindCounts.workModule}, costProject=${kw.fieldKindCounts.costProject}, other=${kw.fieldKindCounts.other}`,
    );
    if (Object.keys(kw.moduleIndexCounts).length) {
      console.log(`  模块序号: ${JSON.stringify(kw.moduleIndexCounts)}`);
    }
    if (kw.workModuleValueSamples.length) {
      console.log(`  工作模块样本: ${[...new Set(kw.workModuleValueSamples)].slice(0, 3).join(" | ")}`);
    }
    if (kw.costProjectValueSamples.length) {
      console.log(`  成本项目样本: ${[...new Set(kw.costProjectValueSamples)].slice(0, 3).join(" | ")}`);
    }
    if (kw.suggestedFilter) {
      const sf = kw.suggestedFilter;
      console.log(
        `  建议 filter [${sf.confidence}]: workModuleContains="${sf.workModuleContains}", costProjectContains="${sf.costProjectContains}"`,
      );
      for (const note of sf.notes) console.log(`    · ${note}`);
    }
    if (kw.reportSamples.length) {
      const s = kw.reportSamples[0]!;
      console.log(
        `  样例 reportId=${s.reportId ?? "(无)"} ${s.creatorName} images=${s.imageCount} attachments=${s.attachmentCount}`,
      );
    }
    console.log("");
  }
}

async function main(): Promise<void> {
  const days = Number(parseArg("days") ?? DEFAULT_PROJECT_VIEW_DISCOVERY_DAYS) || DEFAULT_PROJECT_VIEW_DISCOVERY_DAYS;
  const maxContacts = Number(parseArg("max-contacts") ?? "0") || 0;
  const outPath = parseArg("out");

  const { config } = loadDailyReportDigestConfig();
  const org = config.orgs.find((o) => o.label.includes("微光"));
  if (!org) throw new Error("未找到微光 org 配置");

  const now = new Date();
  const { startTime, endTime } = resolveDiscoveryTimeRange(now, config.timezone, days, config);
  console.log(`组织: ${org.label}，窗口: ${new Date(startTime).toISOString()} .. ${new Date(endTime).toISOString()} (${days} 天)`);

  const allContacts = await listOrgScanContacts(org);
  const contacts = maxContacts > 0 ? allContacts.slice(0, maxContacts) : allContacts;
  console.log(`通讯录: ${allContacts.length} 人，本次扫描 ${contacts.length} 人`);

  const client = createDingTalkReportClient();
  const limit = scanConcurrencyLimit();

  const scanned = await mapWithConcurrency(contacts, limit, async (c) => {
    const reports = await client.fetchUserReports({
      appKey: org.appKey,
      appSecret: org.appSecret,
      userid: c.userid,
      templateName: org.templateName,
      startTime,
      endTime,
    });
    return { userid: c.userid, name: c.name, reports };
  });

  const result = analyzeReportsForProductLineProbe({ contacts: scanned });
  printSummary(result);

  if (outPath) {
    const abs = resolve(outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(result, null, 2), "utf8");
    console.log(`已写入 ${abs}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
