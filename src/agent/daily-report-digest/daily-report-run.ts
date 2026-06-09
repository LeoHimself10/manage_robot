import { logStructured } from "../../infra/logger";
import type { DailyReportDigestConfig } from "./daily-report-config";
import {
  aggregateOrgDigest,
  renderDailyReportMarkdown,
  type OrgDigest,
} from "./daily-report-build";
import {
  createDingTalkReportClient,
  type DingTalkReportClient,
} from "./dingtalk-report-client";
import { sendGroupRobotMarkdown } from "./group-robot-webhook";
import { resolveReportRange, type ReportTimeRange } from "./daily-report-window";

export interface RunDailyReportDigestResult {
  ok: boolean;
  skipped?: string;
  labelYmd: string;
  submittedCount: number;
  missingCount: number;
  errorCount: number;
}

export interface CollectOrgDigestsResult {
  orgDigests: OrgDigest[];
  errorCount: number;
}

/**
 * 拉取各组织目标员工在给定时间范围内的日志并按「已交/未交」聚合（不发送）。
 * 调度器/手动发送与工作台页面共用此采集逻辑。
 */
export async function collectOrgDigests(
  config: DailyReportDigestConfig,
  range: ReportTimeRange,
  deps?: { reportClient?: DingTalkReportClient; fetchImpl?: typeof fetch },
): Promise<CollectOrgDigestsResult> {
  const client =
    deps?.reportClient ?? createDingTalkReportClient({ fetchImpl: deps?.fetchImpl });
  const orgDigests: OrgDigest[] = [];
  let errorCount = 0;

  for (const org of config.orgs) {
    const errorsByUserid: Record<string, string> = {};
    const allReports = [];
    for (const emp of org.employees) {
      try {
        const reps = await client.fetchUserReports({
          appKey: org.appKey,
          appSecret: org.appSecret,
          userid: emp.userid,
          templateName: org.templateName,
          startTime: range.startTime,
          endTime: range.endTime,
        });
        allReports.push(...reps);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        errorsByUserid[emp.userid] = reason;
        errorCount += 1;
        logStructured({
          event: "daily_report_fetch_failed",
          org: org.label,
          userid: emp.userid,
          reason,
        });
      }
    }
    orgDigests.push(aggregateOrgDigest(org, allReports, errorsByUserid));
  }

  return { orgDigests, errorCount };
}

/**
 * 拉取各组织目标员工的昨日日报 → 汇总 → 发到明思群。
 * 不做窗口判断与当日去重（由调度器负责），便于手动脚本直接调用。
 */
export async function runDailyReportDigest(
  config: DailyReportDigestConfig,
  deps?: {
    reportClient?: DingTalkReportClient;
    fetchImpl?: typeof fetch;
    now?: Date;
  },
): Promise<RunDailyReportDigestResult> {
  const now = deps?.now ?? new Date();
  const range = resolveReportRange(now, config.timezone);
  const { orgDigests, errorCount } = await collectOrgDigests(config, range, {
    reportClient: deps?.reportClient,
    fetchImpl: deps?.fetchImpl,
  });

  const rendered = renderDailyReportMarkdown(
    config.title,
    `${range.labelDisplay}（${range.labelYmd}）`,
    orgDigests,
  );

  const sendResult = await sendGroupRobotMarkdown(
    config.webhook,
    { title: config.title, text: rendered.text },
    { fetchImpl: deps?.fetchImpl, now },
  );

  if (!sendResult.ok) {
    logStructured({
      event: "daily_report_send_failed",
      labelYmd: range.labelYmd,
      errcode: sendResult.errcode,
      errmsg: sendResult.errmsg,
    });
    return {
      ok: false,
      skipped: sendResult.errmsg ?? "send_failed",
      labelYmd: range.labelYmd,
      submittedCount: rendered.submittedCount,
      missingCount: rendered.missingCount,
      errorCount,
    };
  }

  logStructured({
    event: "daily_report_sent",
    labelYmd: range.labelYmd,
    submittedCount: rendered.submittedCount,
    missingCount: rendered.missingCount,
    errorCount,
  });
  return {
    ok: true,
    labelYmd: range.labelYmd,
    submittedCount: rendered.submittedCount,
    missingCount: rendered.missingCount,
    errorCount,
  };
}
