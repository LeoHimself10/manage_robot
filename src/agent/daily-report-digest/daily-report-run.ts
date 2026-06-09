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
import {
  fallbackMorningSummary,
  loadDailyReportMorningLlmConfig,
  summarizeMorningReportsWithLlm,
} from "./daily-report-morning-llm";
import {
  type PersonWorkbookLink,
  renderMorningReportMarkdown,
  reportEntriesToSheetRows,
} from "./daily-report-morning-build";
import { createDingTalkWorkbookClient } from "./dingtalk-workbook-client";

export interface RunDailyReportDigestResult {
  ok: boolean;
  skipped?: string;
  labelYmd: string;
  submittedCount: number;
  missingCount: number;
  errorCount: number;
  pushMode?: string;
  workbookCount?: number;
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

async function createPersonWorkbooks(
  config: DailyReportDigestConfig,
  orgDigests: OrgDigest[],
  dateLabel: string,
  deps?: { fetchImpl?: typeof fetch },
): Promise<PersonWorkbookLink[]> {
  if (!config.doc) return [];
  const deployedKey = process.env.DINGTALK_CLIENT_ID ?? "";
  const deployedSecret = process.env.DINGTALK_CLIENT_SECRET ?? "";
  if (!deployedKey || !deployedSecret) {
    logStructured({ event: "daily_report_workbook_skipped", reason: "no_deployed_credentials" });
    return [];
  }

  const wb = createDingTalkWorkbookClient({ fetchImpl: deps?.fetchImpl });
  const links: PersonWorkbookLink[] = [];

  for (const org of orgDigests) {
    for (const emp of org.submitted) {
      const name = `${dateLabel} ${emp.name} 日报`.slice(0, 80);
      try {
        const created = await wb.createWorkbook(deployedKey, deployedSecret, config.doc, name);
        const rows = reportEntriesToSheetRows(emp.reports);
        await wb.writeSheetValues(deployedKey, deployedSecret, config.doc, created.workbookId, rows);
        links.push({ orgLabel: org.label, name: emp.name, url: created.url });
        logStructured({
          event: "daily_report_workbook_created",
          org: org.label,
          name: emp.name,
          workbookId: created.workbookId,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        links.push({ orgLabel: org.label, name: emp.name, url: "", error: reason });
        logStructured({
          event: "daily_report_workbook_failed",
          org: org.label,
          name: emp.name,
          reason,
        });
      }
    }
  }
  return links;
}

async function runMorningDailyReportDigest(
  config: DailyReportDigestConfig,
  orgDigests: OrgDigest[],
  range: ReportTimeRange,
  errorCount: number,
  deps?: { fetchImpl?: typeof fetch; now?: Date },
): Promise<RunDailyReportDigestResult> {
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;
  const llmConfig = loadDailyReportMorningLlmConfig();
  const summary = llmConfig
    ? await summarizeMorningReportsWithLlm(orgDigests, dateLabel, llmConfig, deps?.fetchImpl)
    : fallbackMorningSummary(orgDigests, dateLabel);

  const workbookLinks = await createPersonWorkbooks(config, orgDigests, range.labelYmd, deps);
  const rendered = renderMorningReportMarkdown({
    title: config.title,
    dateLabel,
    summary,
    orgDigests,
    workbookLinks,
  });

  const sendResult = await sendGroupRobotMarkdown(
    config.webhook,
    { title: config.title, text: rendered.text },
    { fetchImpl: deps?.fetchImpl, now: deps?.now },
  );

  if (!sendResult.ok) {
    logStructured({
      event: "daily_report_send_failed",
      labelYmd: range.labelYmd,
      pushMode: "morning",
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
      pushMode: "morning",
      workbookCount: workbookLinks.filter((l) => l.url).length,
    };
  }

  logStructured({
    event: "daily_report_sent",
    labelYmd: range.labelYmd,
    pushMode: "morning",
    submittedCount: rendered.submittedCount,
    missingCount: rendered.missingCount,
    errorCount,
    workbookCount: workbookLinks.filter((l) => l.url).length,
  });
  return {
    ok: true,
    labelYmd: range.labelYmd,
    submittedCount: rendered.submittedCount,
    missingCount: rendered.missingCount,
    errorCount,
    pushMode: "morning",
    workbookCount: workbookLinks.filter((l) => l.url).length,
  };
}

/**
 * 拉取各组织目标员工的昨日日报 → 汇总 → 发到群。
 * pushMode=morning：LLM 早报 + 可选钉钉表格；full：原文 Markdown 拼接。
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

  if (config.pushMode === "morning") {
    return runMorningDailyReportDigest(config, orgDigests, range, errorCount, deps);
  }

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
      pushMode: "full",
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
      pushMode: "full",
    };
  }

  logStructured({
    event: "daily_report_sent",
    labelYmd: range.labelYmd,
    pushMode: "full",
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
    pushMode: "full",
  };
}
