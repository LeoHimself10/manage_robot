#!/usr/bin/env npx tsx
/**
 * 生成与早报相同 Markdown，仅 1:1 私发给姚凯珩（mingsibot / 任务拆解助手）。
 * 不调用群 Webhook。
 *
 * Usage:
 *   DAILY_REPORT_DIGEST_CONFIG_FILE=/path/config.json npx tsx scripts/send-daily-report-preview-to-yao.ts
 *   npx tsx scripts/send-daily-report-preview-to-yao.ts --date=2026-06-06
 */
import "dotenv/config";
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config";
import {
  collectOrgDigests,
} from "../src/agent/daily-report-digest/daily-report-run";
import {
  fallbackMorningSummary,
  loadDailyReportMorningLlmConfig,
  summarizeMorningReportsWithLlm,
} from "../src/agent/daily-report-digest/daily-report-morning-llm";
import { renderMorningReportMarkdown } from "../src/agent/daily-report-digest/daily-report-morning-build";
import { buildDailyReportsPublicUrlForDingtalkOutbound } from "../src/agent/daily-report-digest/daily-report-workbench-link";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../src/agent/daily-report-digest/daily-report-window";

const YAO_USER_ID = "652949075622784820";

function parseDateArg(): string | undefined {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--date=")) return arg.slice("--date=".length).trim() || undefined;
  }
  return undefined;
}

async function fetchAccessToken(): Promise<string> {
  const appKey = process.env.DINGTALK_CLIENT_ID?.trim();
  const appSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  if (!appKey || !appSecret) throw new Error("missing DINGTALK credentials");
  const res = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  const token = String(data.accessToken ?? data.access_token ?? "").trim();
  if (!token) throw new Error(`token failed: ${JSON.stringify(data)}`);
  return token;
}

async function sendRobotMarkdown(params: {
  accessToken: string;
  robotCode: string;
  userId: string;
  title: string;
  markdown: string;
  detailUrl: string;
}): Promise<string> {
  const res = await fetch("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-acs-dingtalk-access-token": params.accessToken,
    },
    body: JSON.stringify({
      robotCode: params.robotCode,
      userIds: [params.userId],
      msgKey: "sampleActionCard",
      msgParam: JSON.stringify({
        title: params.title,
        text: params.markdown,
        singleTitle: "打开工作台日报",
        singleURL: params.detailUrl,
      }),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`robot send failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return String(data.processQueryKey ?? data.requestId ?? "");
}

async function main(): Promise<void> {
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    console.error("配置无效：", errors.join("；"));
    process.exit(1);
  }

  const dateArg = parseDateArg();
  const now = new Date();
  const range = dateArg
    ? resolveDayRangeForYmd(dateArg, config.timezone)
    : resolveReportRange(now, config.timezone);
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;

  const { orgDigests, errorCount } = await collectOrgDigests(config, range);
  const llmConfig = loadDailyReportMorningLlmConfig();
  const summary = llmConfig
    ? await summarizeMorningReportsWithLlm(orgDigests, dateLabel, llmConfig)
    : fallbackMorningSummary(orgDigests, dateLabel);

  const workbenchUrl = buildDailyReportsPublicUrlForDingtalkOutbound({
    dateYmd: range.labelYmd,
    view: "project",
  });
  const rendered = renderMorningReportMarkdown({
    title: config.title,
    dateLabel,
    dateYmd: range.labelYmd,
    summary,
    orgDigests,
    workbenchUrl: workbenchUrl || undefined,
  });

  const robotCode = process.env.DINGTALK_ROBOT_CODE?.trim() || process.env.DINGTALK_CLIENT_ID?.trim();
  if (!robotCode) throw new Error("missing DINGTALK_ROBOT_CODE or DINGTALK_CLIENT_ID");

  const token = await fetchAccessToken();
  const detailUrl = workbenchUrl || process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL || "https://example.com";
  const robotKey = await sendRobotMarkdown({
    accessToken: token,
    robotCode,
    userId: YAO_USER_ID,
    title: `${config.title} · 预览（私发）`,
    markdown: rendered.text,
    detailUrl,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        to: "姚凯珩",
        userId: YAO_USER_ID,
        date: range.labelYmd,
        submittedCount: rendered.submittedCount,
        missingCount: rendered.missingCount,
        errorCount,
        workbenchUrl,
        robotMessageKey: robotKey,
        note: "未调用群 Webhook",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
