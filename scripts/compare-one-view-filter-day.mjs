#!/usr/bin/env node
/** Single-view v1 vs v2 compare for one date (fast probe). */
import fs from "node:fs";
import {
  filterReportEntryByModuleProjectPair,
  filterReportEntryForView,
} from "../src/agent/daily-report-digest/daily-report-project-view-filter.ts";
import { filterReportEntry } from "../src/agent/daily-report-digest/daily-report-content-filter.ts";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.ts";
import { listOrgScanContacts } from "../src/agent/daily-report-digest/daily-report-org-scan-contacts.ts";
import { resolveDayRangeForYmd } from "../src/agent/daily-report-digest/daily-report-window.ts";
import { parseProjectViewConfig } from "../src/agent/daily-report-digest/daily-report-project-views.ts";

const CONFIG_PATH = process.env.DAILY_REPORT_DIGEST_CONFIG_FILE || "/app/data/daily-report-digest.config.json";
const ORG_LABEL = "微光";
const VIEW_ID = process.env.VIEW_ID || "semiconductor-vein";
const YMD = process.env.YMD || "2026-06-22";

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const org = (cfg.orgs || []).find((o) => o.label === ORG_LABEL);
const raw = (org?.projectViews || []).find((v) => v.id === VIEW_ID);
const view = parseProjectViewConfig(raw, org.label);
if (!view) {
  console.error("view not found", VIEW_ID);
  process.exit(1);
}

const legacyPair = {
  workModuleContains: view.filters.workModuleContains,
  costProjectContains: view.filters.costProjectContains,
};

const contacts = await listOrgScanContacts(org);
const client = createDingTalkReportClient();
const range = resolveDayRangeForYmd(YMD, cfg.timezone || "Asia/Shanghai", {
  cutoffHour: cfg.reportDayCutoffHour ?? 17,
  cutoffMinute: cfg.reportDayCutoffMinute ?? 0,
});

let v1Hits = [];
let v2Hits = [];
let v2Only = [];

for (const contact of contacts) {
  const reps = await client.fetchUserReports({
    appKey: org.appKey,
    appSecret: org.appSecret,
    userid: contact.userid,
    templateName: org.templateName,
    startTime: range.startTime,
    endTime: range.endTime,
  });
  for (const r of reps) {
    const v1 = filterReportEntry(filterReportEntryByModuleProjectPair(r, legacyPair));
    const v2 = filterReportEntry(filterReportEntryForView(r, view.filters));
    const v1ok = v1.contents.length > 0;
    const v2ok = v2.contents.length > 0;
    const name = r.creatorName || contact.name || contact.userid;
    if (v1ok) v1Hits.push(name);
    if (v2ok) v2Hits.push(name);
    if (v2ok && !v1ok) {
      const blocks = v2.contents
        .filter((f) => f.key.includes("工作模块") || f.key.includes("成本归属"))
        .map((f) => f.value);
      v2Only.push({ name, blocks });
    }
  }
}

console.log(
  JSON.stringify(
    {
      viewId: VIEW_ID,
      label: view.label,
      keyword: view.filters.keyword,
      legacyPair,
      ymd: YMD,
      v1Count: v1Hits.length,
      v2Count: v2Hits.length,
      delta: v2Hits.length - v1Hits.length,
      v1Hits,
      v2Hits,
      v2Only,
    },
    null,
    2,
  ),
);
