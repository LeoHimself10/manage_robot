#!/usr/bin/env node
/** Read-only probe: scan 微光 logs for custom projectView filter matches. No notifications. */
import fs from "node:fs";
import { filterReportEntryByModuleProjectPair } from "../src/agent/daily-report-digest/daily-report-project-view-filter.ts";
import { filterReportEntry } from "../src/agent/daily-report-digest/daily-report-content-filter.ts";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.ts";
import { listOrgScanContacts } from "../src/agent/daily-report-digest/daily-report-org-scan-contacts.ts";
import { resolveDayRangeForYmd } from "../src/agent/daily-report-digest/daily-report-window.ts";

const CONFIG_PATH = process.env.DAILY_REPORT_DIGEST_CONFIG_FILE || "/app/data/daily-report-digest.config.json";
const DAYS = Number(process.env.PROBE_DAYS || 14);
const FILTER = {
  workModuleContains: process.env.WORK_MODULE || "半导体激光",
  costProjectContains: process.env.COST_PROJECT || "静脉腔内闭合系统",
};
const ORG_LABEL = process.env.ORG_LABEL || "微光";
const END_YMD = process.env.END_YMD || new Date().toISOString().slice(0, 10);

function addDays(ymd, d) {
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day + d)).toISOString().slice(0, 10);
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const org = (cfg.orgs || []).find((o) => o.label === ORG_LABEL);
if (!org) {
  console.error("org not found:", ORG_LABEL);
  process.exit(1);
}

const contacts = await listOrgScanContacts(org);
const client = createDingTalkReportClient();
const hits = [];

for (let i = 0; i < DAYS; i += 1) {
  const ymd = addDays(END_YMD, -i);
  const range = resolveDayRangeForYmd(ymd, cfg.timezone || "Asia/Shanghai", {
    cutoffHour: cfg.reportDayCutoffHour ?? 17,
    cutoffMinute: cfg.reportDayCutoffMinute ?? 0,
  });
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
      const filtered = filterReportEntry(filterReportEntryByModuleProjectPair(r, FILTER));
      if (filtered.contents.length === 0) continue;
      const blocks = filtered.contents
        .filter((f) => f.key.includes("事项-结果") || f.key.includes("工作模块"))
        .map((f) => `${f.key}: ${f.value}`);
      hits.push({
        date: ymd,
        name: r.creatorName || contact.name || contact.userid,
        userid: contact.userid,
        blocks,
      });
    }
  }
}

const rosterByUserid = new Map();
for (const hit of hits) {
  if (!rosterByUserid.has(hit.userid)) {
    rosterByUserid.set(hit.userid, { userid: hit.userid, name: hit.name });
  }
}
const rosterCandidates = [...rosterByUserid.values()];

console.log(
  JSON.stringify(
    {
      filter: FILTER,
      org: ORG_LABEL,
      days: DAYS,
      endYmd: END_YMD,
      scanContactCount: contacts.length,
      rosterCandidates,
      hitCount: hits.length,
      hits,
    },
    null,
    2,
  ),
);
