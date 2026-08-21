#!/usr/bin/env npx tsx
/** 拉一条真实日报原始字段 + 拼多种详情 URL，供手工验证。 */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.js";
import { resolveReportRange } from "../src/agent/daily-report-digest/daily-report-window.js";

const USERID = process.argv[2] || "16498995179818822";

async function main(): Promise<void> {
  const { config } = loadDailyReportDigestConfig();
  const org = config.orgs.find((o) => o.label.includes("微光"))!;
  const range = resolveReportRange(new Date(), config.timezone);
  const client = createDingTalkReportClient();
  const token = await client.getAccessToken(org.appKey, org.appSecret);

  const listRes = await fetch(
    `https://oapi.dingtalk.com/topapi/report/list?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_time: range.startTime,
        end_time: range.endTime,
        cursor: 0,
        size: 3,
        userid: USERID,
      }),
    },
  );
  const list = (await listRes.json()) as { result?: { data_list?: Record<string, unknown>[] } };
  const raw = list.result?.data_list?.[0];
  if (!raw) {
    console.log("no report");
    process.exit(1);
  }

  const corpId = process.env.DINGTALK_CORP_ID?.trim() || "";
  const reportId = String(raw.report_id ?? "");
  const creatorId = String(raw.creator_id ?? raw.creator_userid ?? USERID);

  // report/get if exists
  let getRaw: unknown = null;
  for (const api of [
    "topapi/report/get",
    "topapi/report/receive/get",
  ]) {
    try {
      const r = await fetch(
        `https://oapi.dingtalk.com/${api}?access_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ report_id: reportId }),
        },
      );
      const j = await r.json();
      if (j.errcode === 0) getRaw = { api, j };
    } catch {
      // ignore
    }
  }

  const h5Base = "https://landray.dingtalkapps.com/alid/app/report/viewreport.html";
  const pcBase = "https://landray.dingtalkapps.com/alid/app/reportpc/viewreport.html";
  const mobileBase = "https://landray.dingtalkapps.com/alid/app/report/viewreport.html";

  const variants = [
    `${h5Base}?corpid=${corpId}&reportid=${reportId}&comeFromInside=1&userid=${creatorId}`,
    `${h5Base}?corpid=${corpId}&reportid=${reportId}&comeFromInside=1`,
    `${h5Base}?corpid=${corpId}&id=${reportId}&comeFromInside=1&userid=${creatorId}`,
    `${pcBase}?corpid=${corpId}&reportid=${reportId}&comeFromInside=1&userid=${creatorId}`,
    `${pcBase}?corpid=${corpId}&reportid=${reportId}&comeFromInside=1`,
    `${mobileBase}?corpid=${corpId}&reportid=${reportId}&dd_from=inside`,
  ];

  console.log(JSON.stringify({
    corpId,
    orgAppKey: org.appKey,
    rawKeys: Object.keys(raw),
    rawSample: raw,
    getRaw,
    variants,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
