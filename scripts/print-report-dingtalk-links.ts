#!/usr/bin/env npx tsx
/** 打印一条真实日报的深链各形态，供 ECS 手工验证。 */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import {
  buildOpenReportInDingtalkPayload,
  buildReportDetailH5Url,
} from "../src/agent/daily-report-digest/daily-report-dingtalk-report-link.js";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.js";
import { resolveReportRange } from "../src/agent/daily-report-digest/daily-report-window.js";

const USERID = process.argv[2] || "16498995179818822"; // 胡书剑

async function main(): Promise<void> {
  const { config } = loadDailyReportDigestConfig();
  const org = config.orgs.find((o) => o.label.includes("微光"))!;
  const range = resolveReportRange(new Date(), config.timezone);
  const client = createDingTalkReportClient();
  const reps = await client.fetchUserReports({
    appKey: org.appKey,
    appSecret: org.appSecret,
    userid: USERID,
    startTime: range.startTime,
    endTime: range.endTime,
  });
  const r = reps[0];
  if (!r?.reportId) {
    console.log("no report");
    process.exit(1);
  }
  const links = buildOpenReportInDingtalkPayload({
    reportId: r.reportId,
    creatorUserId: r.creatorUserId || USERID,
  });
  console.log(JSON.stringify({
    reportId: r.reportId,
    creatorUserId: r.creatorUserId,
    templateName: r.templateName,
    h5Only: buildReportDetailH5Url({
      reportId: r.reportId,
      corpId: process.env.DINGTALK_CORP_ID!,
      creatorUserId: r.creatorUserId || USERID,
    }),
    links,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
