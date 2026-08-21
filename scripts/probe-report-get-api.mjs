#!/usr/bin/env node
import { readFileSync } from "node:fs";

const cfg = JSON.parse(readFileSync("/app/data/daily-report-digest.config.json", "utf8"));
const org = cfg.orgs.find((o) => o.label.includes("微光"));
const r = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ appKey: org.appKey, appSecret: org.appSecret }),
});
const { accessToken } = await r.json();
const reportId = "19ee983558c87b871d9a12a445895868";
const userid = "16498995179818822";

const apis = [
  ["topapi/report/get", { report_id: reportId }],
  ["topapi/report/receive/get", { report_id: reportId }],
  ["topapi/report/statistics/get", { report_id: reportId, offset: 0, size: 1 }],
  [
    "topapi/report/template/getbyname",
    { template_name: "研发中心日志（总结及计划）模板", userid },
  ],
];
for (const [api, body] of apis) {
  const res = await fetch(
    `https://oapi.dingtalk.com/${api}?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const j = await res.json();
  console.log("\n===", api, "===");
  console.log(JSON.stringify(j, null, 2).slice(0, 1200));
}

const userRes = await fetch(
  `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(accessToken)}`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid }),
  },
);
console.log("\n=== user.get ===");
console.log(JSON.stringify(await userRes.json(), null, 2).slice(0, 800));
