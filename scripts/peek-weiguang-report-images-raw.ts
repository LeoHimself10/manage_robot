#!/usr/bin/env npx tsx
/** 探测 report/list 原始 images / type 字段（找含 [图片] 的日报）。 */
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config.js";
import { createDingTalkReportClient } from "../src/agent/daily-report-digest/dingtalk-report-client.js";
import { listOrgScanContacts } from "../src/agent/daily-report-digest/daily-report-org-scan-contacts.js";
import { resolveReportRange } from "../src/agent/daily-report-digest/daily-report-window.js";

async function main(): Promise<void> {
  const nameNeedle = process.argv[2] || "胡书剑";
  const { config } = loadDailyReportDigestConfig();
  const org = config.orgs.find((o) => o.label.includes("微光"))!;
  const range = resolveReportRange(new Date(), config.timezone);
  const contacts = await listOrgScanContacts(org);
  const hit = contacts.filter((c) => c.name.includes(nameNeedle));
  if (!hit.length) {
    console.log("no contact for", nameNeedle);
    process.exit(1);
  }
  const client = createDingTalkReportClient();
  const token = await client.getAccessToken(org.appKey, org.appSecret);
  for (const c of hit.slice(0, 2)) {
    const res = await fetch(
      `https://oapi.dingtalk.com/topapi/report/list?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: range.startTime,
          end_time: range.endTime,
          cursor: 0,
          size: 5,
          userid: c.userid,
        }),
      },
    );
    const data = await res.json();
    console.log(`\n=== ${c.name} ${c.userid} ===`);
    for (const item of data.result?.data_list ?? []) {
      const hasPicTag = JSON.stringify(item.contents ?? []).includes("图片");
      const imgs = item.images;
      console.log({
        report_id: item.report_id,
        template: item.template_name,
        hasPicTag,
        imagesRaw: imgs,
        contentTypes: (item.contents ?? []).map((x: { key: string; type: string; value: string }) => ({
          key: x.key,
          type: x.type,
          valuePreview: String(x.value ?? "").slice(0, 80),
        })),
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
