#!/usr/bin/env node
/** Compare v1 pair filter vs v2 keyword filter hit counts per projectView (read-only). */
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
const ORG_LABEL = process.env.ORG_LABEL || "微光";
const END_YMD = process.env.END_YMD || "2026-06-22";
const DAYS = Number(process.env.PROBE_DAYS || 7);

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

const views = (org.projectViews || [])
  .map((raw) => parseProjectViewConfig(raw, org.label))
  .filter(Boolean);

const contacts = await listOrgScanContacts(org);
const client = createDingTalkReportClient();

const summary = [];

for (const view of views) {
  const legacyPair =
    view.filters.workModuleContains && view.filters.costProjectContains
      ? {
          workModuleContains: view.filters.workModuleContains,
          costProjectContains: view.filters.costProjectContains,
        }
      : null;

  let v1Hits = 0;
  let v2Hits = 0;
  const v2OnlySamples = [];

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
        const v2 = filterReportEntry(filterReportEntryForView(r, view.filters));
        const v2ok = v2.contents.length > 0;
        if (v2ok) v2Hits += 1;

        let v1ok = false;
        if (legacyPair) {
          const v1 = filterReportEntry(filterReportEntryByModuleProjectPair(r, legacyPair));
          v1ok = v1.contents.length > 0;
          if (v1ok) v1Hits += 1;
        }

        if (v2ok && !v1ok && v2OnlySamples.length < 5) {
          const blocks = v2.contents
            .filter((f) => f.key.includes("工作模块") || f.key.includes("成本归属"))
            .slice(0, 4)
            .map((f) => `${f.key}: ${f.value}`);
          v2OnlySamples.push({
            date: ymd,
            name: r.creatorName || contact.name,
            userid: contact.userid,
            blocks,
          });
        }
      }
    }
  }

  summary.push({
    id: view.id,
    label: view.label,
    keyword: view.filters.keyword ?? null,
    legacyPair,
    days: DAYS,
    endYmd: END_YMD,
    v1HitReports: legacyPair ? v1Hits : null,
    v2HitReports: v2Hits,
    delta: legacyPair ? v2Hits - v1Hits : null,
    v2OnlySamples,
  });
}

console.log(JSON.stringify({ org: ORG_LABEL, scanContacts: contacts.length, summary }, null, 2));
