import { loadDailyReportDigestConfig } from "../agent/daily-report-digest/daily-report-config";
import { collectOrgDigests } from "../agent/daily-report-digest/daily-report-run";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../agent/daily-report-digest/daily-report-window";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyReportsHttpPayload {
  ok: boolean;
  error?: string;
  configured?: boolean;
  date?: string;
  dateLabel?: string;
  generatedAt?: string;
  submittedCount?: number;
  missingCount?: number;
  errorCount?: number;
  orgs?: Array<{
    label: string;
    submitted: Array<{
      userid: string;
      name: string;
      reports: Array<{
        templateName: string;
        createTime: number;
        contents: Array<{ key: string; value: string; type?: string; attachments?: Array<{ name: string; url?: string }> }>;
      }>;
      images?: Array<{ name: string; url?: string }>;
    }>;
    missing: Array<{ userid: string; name: string }>;
    errors: Array<{ userid: string; name: string; reason: string }>;
  }>;
}

/**
 * 工作台「跨组织日报」页面的数据源：实时拉取两个组织目标员工某天的钉钉日志并聚合。
 * 与每日 7:00 群推共用配置与采集逻辑（`collectOrgDigests`），但此处只读、不发送。
 */
export async function buildDailyReportsHttpPayload(input?: {
  date?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
}): Promise<DailyReportsHttpPayload> {
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    return {
      ok: false,
      configured: false,
      error: `日报功能未配置或配置无效：${errors.join("；")}`,
    };
  }

  const now = input?.now ?? new Date();
  const date = input?.date?.trim();
  if (date && !YMD_RE.test(date)) {
    return { ok: false, error: `非法日期格式：${date}（应为 YYYY-MM-DD）` };
  }
  const range = date
    ? resolveDayRangeForYmd(date, config.timezone)
    : resolveReportRange(now, config.timezone);

  const { orgDigests, errorCount } = await collectOrgDigests(config, range, {
    fetchImpl: input?.fetchImpl,
  });

  let submittedCount = 0;
  let missingCount = 0;
  const orgs = orgDigests.map((org) => {
    submittedCount += org.submitted.length;
    missingCount += org.missing.length;
    return {
      label: org.label,
      submitted: org.submitted.map((emp) => ({
        userid: emp.userid,
        name: emp.name,
        reports: emp.reports.map((r) => ({
          templateName: r.templateName,
          createTime: r.createTime,
          contents: r.contents,
          images: r.images,
        })),
      })),
      missing: org.missing,
      errors: org.errors,
    };
  });

  return {
    ok: true,
    configured: true,
    date: range.labelYmd,
    dateLabel: range.labelDisplay,
    generatedAt: now.toISOString(),
    submittedCount,
    missingCount,
    errorCount,
    orgs,
  };
}
