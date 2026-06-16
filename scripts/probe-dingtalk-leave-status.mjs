#!/usr/bin/env node
/** Probe DingTalk getleavestatus for one org. */
import fs from "node:fs";

const CONFIG_PATH = "/app/data/daily-report-digest.config.json";
const DEPLOYED_KEY = process.env.DINGTALK_CLIENT_ID || "";
const DEPLOYED_SEC = process.env.DINGTALK_CLIENT_SECRET || "";
const YMD = process.env.QUERY_YMD || "2026-06-15";
const TZ = "Asia/Shanghai";

function zonedLocalDateTimeUtcIso(ymd, hour, minute, timezone) {
  const [y, m, d] = ymd.split("-").map(Number);
  let lo = Date.UTC(y, m - 1, d - 1), hi = Date.UTC(y, m - 1, d + 2);
  const target = hour * 60 + minute;
  function parts(ms) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date(ms));
    const pick = (t) => p.find((x) => x.type === t)?.value ?? "";
    let h = Number(pick("hour")); if (h === 24) h = 0;
    return { ymd: `${pick("year")}-${pick("month")}-${pick("day")}`, minutes: h * 60 + Number(pick("minute")) };
  }
  while (lo < hi) { const mid = Math.floor((lo + hi) / 2); const { ymd: my, minutes } = parts(mid); if (my < ymd || (my === ymd && minutes < target)) lo = mid + 1; else hi = mid; }
  return new Date(lo).toISOString();
}
function addDays(ymd, d) { const [y,m,day]=ymd.split('-').map(Number); return new Date(Date.UTC(y,m-1,day+d)).toISOString().slice(0,10); }

async function getToken(ak, sec) {
  const r = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({appKey:ak,appSecret:sec})});
  return await r.json();
}
async function getLeave(token, userids, start, end) {
  const r = await fetch(`https://oapi.dingtalk.com/topapi/attendance/getleavestatus?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid_list: userids.join(","), start_time: start, end_time: end, offset: 0, size: 20 }),
  });
  return await r.json();
}

const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const since = Date.parse(zonedLocalDateTimeUtcIso(YMD, 17, 0, TZ));
const until = Date.parse(zonedLocalDateTimeUtcIso(addDays(YMD, 1), 17, 0, TZ)) - 1;
console.log(`leave probe biz day ${YMD}: ${since} ~ ${until}`);

for (const org of cfg.orgs) {
  const ak = org.appKey || DEPLOYED_KEY;
  const sec = org.appSecret || DEPLOYED_SEC;
  const tokRes = await getToken(ak, sec);
  const token = tokRes.accessToken ?? tokRes.access_token;
  const userids = org.employees.map((e) => e.userid);
  console.log(`\nORG ${org.label} employees=${userids.length}`);
  const data = await getLeave(token, userids, since, until);
  console.log(JSON.stringify(data, null, 2));
}
