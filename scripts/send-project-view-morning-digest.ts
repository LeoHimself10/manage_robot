#!/usr/bin/env npx tsx
/**
 * 微光 projectView 项目组早报：LLM 综述 + 按人摘要 + 工作台深链，1:1 机器人私发。
 * 阶段 1 验收：默认只发姚凯珩，验收通过前勿向曹一挥发送。
 *
 * Usage:
 *   npx tsx scripts/send-project-view-morning-digest.ts --view=semiconductor-vein
 *   npx tsx scripts/send-project-view-morning-digest.ts --view=semiconductor-vein --dry-run
 *   npx tsx scripts/send-project-view-morning-digest.ts --view=semiconductor-vein --date=2026-06-08
 */
import "dotenv/config";
import { loadDailyReportDigestConfig } from "../src/agent/daily-report-digest/daily-report-config";
import { loadOrCollectProjectViewDigest } from "../src/agent/daily-report-digest/daily-report-project-view-digest-collect";
import {
  loadDailyReportMorningLlmConfig,
  summarizeProjectViewMorningWithLlm,
  fallbackProjectViewMorningSummary,
} from "../src/agent/daily-report-digest/daily-report-project-view-morning-llm";
import { renderProjectViewMorningMarkdown } from "../src/agent/daily-report-digest/daily-report-project-view-morning-render";
import { buildDailyReportsPublicUrlForDingtalkOutbound } from "../src/agent/daily-report-digest/daily-report-workbench-link";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../src/agent/daily-report-digest/daily-report-window";

/** 姚凯珩 — 阶段 1 默认收件人 */
const DEFAULT_TO_USER_ID = "652949075622784820";
const DEFAULT_VIEW_ID = "semiconductor-vein";

function parseArgs(): {
  viewId: string;
  toUserId: string;
  dateYmd?: string;
  dryRun: boolean;
} {
  let viewId = DEFAULT_VIEW_ID;
  let toUserId = DEFAULT_TO_USER_ID;
  let dateYmd: string | undefined;
  let dryRun = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--view=")) viewId = arg.slice("--view=".length).trim() || DEFAULT_VIEW_ID;
    else if (arg.startsWith("--to=")) toUserId = arg.slice("--to=".length).trim() || DEFAULT_TO_USER_ID;
    else if (arg.startsWith("--date=")) dateYmd = arg.slice("--date=".length).trim() || undefined;
  }

  return { viewId, toUserId, dateYmd, dryRun };
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
  const { viewId, toUserId, dateYmd, dryRun } = parseArgs();

  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    console.error("配置无效：", errors.join("；"));
    process.exit(1);
  }

  const now = new Date();
  const range = dateYmd
    ? resolveDayRangeForYmd(dateYmd, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      })
    : resolveReportRange(now, config.timezone, {
        cutoffHour: config.reportDayCutoffHour,
        cutoffMinute: config.reportDayCutoffMinute,
      });
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;

  const ctx = await loadOrCollectProjectViewDigest({
    config,
    viewId,
    range,
  });

  const submittedCount = ctx.orgDigest.submitted.length;
  const llmConfig = loadDailyReportMorningLlmConfig();
  const summary = llmConfig
    ? await summarizeProjectViewMorningWithLlm(
        ctx.view.label,
        dateLabel,
        ctx.rosterCount,
        ctx.orgDigest,
        llmConfig,
      )
    : fallbackProjectViewMorningSummary(
        ctx.view.label,
        dateLabel,
        ctx.rosterCount,
        ctx.orgDigest,
      );

  const workbenchUrl = buildDailyReportsPublicUrlForDingtalkOutbound({
    dateYmd: range.labelYmd,
    view: `custom:${viewId}`,
  });

  const rendered = renderProjectViewMorningMarkdown({
    viewLabel: ctx.view.label,
    dateLabel,
    dateYmd: range.labelYmd,
    summary,
    submittedCount,
    rosterCount: ctx.rosterCount,
    workbenchUrl: workbenchUrl || undefined,
  });

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          viewId,
          viewLabel: ctx.view.label,
          date: range.labelYmd,
          toUserId,
          rosterCount: ctx.rosterCount,
          submittedCount,
          fromCache: ctx.fromCache,
          errorCount: ctx.orgDigest.errors.length,
          workbenchUrl,
          markdown: rendered.text,
        },
        null,
        2,
      ),
    );
    return;
  }

  const robotCode =
    process.env.DINGTALK_ROBOT_CODE?.trim() || process.env.DINGTALK_CLIENT_ID?.trim();
  if (!robotCode) throw new Error("missing DINGTALK_ROBOT_CODE or DINGTALK_CLIENT_ID");

  const token = await fetchAccessToken();
  const detailUrl =
    workbenchUrl || process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL || "https://example.com";
  const robotKey = await sendRobotMarkdown({
    accessToken: token,
    robotCode,
    userId: toUserId,
    title: `${rendered.title} · 预览（私发）`,
    markdown: rendered.text,
    detailUrl,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: false,
        toUserId,
        viewId,
        viewLabel: ctx.view.label,
        date: range.labelYmd,
        rosterCount: ctx.rosterCount,
        submittedCount,
        fromCache: ctx.fromCache,
        errorCount: ctx.orgDigest.errors.length,
        workbenchUrl,
        robotMessageKey: robotKey,
        note: "阶段1验收：默认发姚凯珩；勿向曹一挥发送直至验收通过",
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
