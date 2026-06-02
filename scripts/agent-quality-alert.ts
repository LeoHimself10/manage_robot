/**
 * Daily quality SLO check — logs agent_quality_alert on threshold breach.
 * Run: npx tsx scripts/agent-quality-alert.ts [--date=YYYY-MM-DD]
 */
import { getAgentMetricsStore } from "../src/infra/agent-metrics-store";
import { localDayUtcRange, todayYmdInMetricsTz } from "../src/infra/metrics-day-bounds";
import { logStructured } from "../src/infra/logger";

const date = process.argv.find((a) => a.startsWith("--date="))?.split("=")[1]
  ?? todayYmdInMetricsTz();

const maxTurnsRateMax = Number(process.env.SLO_MAX_TURNS_RATE_MAX ?? "0.02");
const p90LoopMsMax = Number(process.env.SLO_P90_LOOP_MS_MAX ?? "120000");
const qualityFailRateMax = Number(process.env.SLO_QUALITY_FAIL_RATE_MAX ?? "0.15");
const judgeFailRateMax = Number(process.env.SLO_JUDGE_FAIL_RATE_MAX ?? "0.10");

const store = getAgentMetricsStore();
store.rollupDailyForDate(date);
const rows = store.queryUsageDaily(date, date);
const alerts: string[] = [];

const { fromIso, toIso } = localDayUtcRange(date);
const quality = store.queryQualitySummary(fromIso, toIso);
if (quality.sampled > 0) {
  const failRate = quality.qualityFail / quality.sampled;
  if (failRate > qualityFailRateMax) {
    alerts.push(`quality_fail rate ${failRate.toFixed(3)} > ${qualityFailRateMax}`);
  }
}
if (quality.judgeScored > 0) {
  const judgeFailRate = quality.judgeFail / quality.judgeScored;
  if (judgeFailRate > judgeFailRateMax) {
    alerts.push(`judge_fail rate ${judgeFailRate.toFixed(3)} > ${judgeFailRateMax}`);
  }
}

for (const row of rows) {
  const incidents = row.incidentCount;
  const maxTurns = incidents.orchestrator_max_turns_exceeded ?? 0;
  const rate = row.turnCount > 0 ? maxTurns / row.turnCount : 0;
  if (rate > maxTurnsRateMax) {
    alerts.push(`${row.channel}: max_turns rate ${rate.toFixed(3)} > ${maxTurnsRateMax}`);
  }
  if ((incidents.false_publish_observed ?? 0) > 0) {
    alerts.push(`${row.channel}: false_publish_observed=${incidents.false_publish_observed}`);
  }
  if ((incidents.dingtalk_tool_name_leak ?? 0) > 0) {
    alerts.push(`${row.channel}: dingtalk_tool_name_leak=${incidents.dingtalk_tool_name_leak}`);
  }
  if (row.p90LoopMs > p90LoopMsMax) {
    alerts.push(`${row.channel}: p90LoopMs ${row.p90LoopMs} > ${p90LoopMsMax}`);
  }
}

if (alerts.length) {
  logStructured({
    event: "agent_quality_alert",
    date,
    alerts,
    severity: "warn",
  });
  console.error("ALERTS:\n" + alerts.join("\n"));
  process.exit(1);
}

console.log(`SLO OK for ${date}`);
process.exit(0);
