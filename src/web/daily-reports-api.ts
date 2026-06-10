import { loadDailyReportDigestConfig } from "../agent/daily-report-digest/daily-report-config";
import { collectOrgDigests } from "../agent/daily-report-digest/daily-report-run";
import {
  groupOrgDigestsByProject,
  listProjectGroupAssignmentsFromConfig,
  PROJECT_GROUPS,
  type ProjectGroupId,
} from "../agent/daily-report-digest/daily-report-project-groups";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../agent/daily-report-digest/daily-report-window";
import type { DailyReportsViewMode } from "../agent/daily-report-digest/daily-report-workbench-link";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DailyReportsOrgPayload {
  label: string;
  submitted: Array<{
    userid: string;
    name: string;
    projectGroup?: ProjectGroupId;
    reports: Array<{
      templateName: string;
      createTime: number;
      contents: Array<{ key: string; value: string; type?: string; attachments?: Array<{ name: string; url?: string }> }>;
      images?: Array<{ name: string; url?: string }>;
    }>;
  }>;
  missing: Array<{ userid: string; name: string; projectGroup?: ProjectGroupId }>;
  errors: Array<{ userid: string; name: string; reason: string }>;
}

export interface DailyReportsProjectGroupPayload {
  id: ProjectGroupId;
  label: string;
  orgs: DailyReportsOrgPayload[];
}

export interface DailyReportsHttpPayload {
  ok: boolean;
  error?: string;
  configured?: boolean;
  view?: DailyReportsViewMode;
  date?: string;
  dateLabel?: string;
  generatedAt?: string;
  submittedCount?: number;
  missingCount?: number;
  errorCount?: number;
  orgs?: DailyReportsOrgPayload[];
  projectGroups?: DailyReportsProjectGroupPayload[];
}

function mapOrgDigest(org: Awaited<ReturnType<typeof collectOrgDigests>>["orgDigests"][0], assignments: Map<string, ProjectGroupId>): DailyReportsOrgPayload {
  return {
    label: org.label,
    submitted: org.submitted.map((emp) => ({
      userid: emp.userid,
      name: emp.name,
      projectGroup: assignments.get(emp.userid),
      reports: emp.reports.map((r) => ({
        templateName: r.templateName,
        createTime: r.createTime,
        contents: r.contents,
        images: r.images,
      })),
    })),
    missing: org.missing.map((m) => ({
      userid: m.userid,
      name: m.name,
      projectGroup: assignments.get(m.userid),
    })),
    errors: org.errors,
  };
}

function parseView(raw: unknown): DailyReportsViewMode {
  const v = String(raw ?? "").trim().toLowerCase();
  return v === "company" ? "company" : "project";
}

/**
 * 工作台「跨组织日报」页面的数据源：实时拉取各组织目标员工某天的钉钉日志并聚合。
 */
export async function buildDailyReportsHttpPayload(input?: {
  date?: string;
  view?: DailyReportsViewMode;
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

  const view = parseView(input?.view);
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

  const assignmentsList = listProjectGroupAssignmentsFromConfig(config.orgs);
  const assignmentMap = new Map(assignmentsList.map((a) => [a.userid, a.projectGroup]));

  let submittedCount = 0;
  let missingCount = 0;
  const orgs = orgDigests.map((org) => {
    submittedCount += org.submitted.length;
    missingCount += org.missing.length;
    return mapOrgDigest(org, assignmentMap);
  });

  const grouped = groupOrgDigestsByProject(orgDigests, assignmentsList);
  const projectGroups: DailyReportsProjectGroupPayload[] = grouped.map((g) => ({
    id: g.id,
    label: g.label,
    orgs: g.orgs.map((org) => mapOrgDigest(org, assignmentMap)),
  }));

  return {
    ok: true,
    configured: true,
    view,
    date: range.labelYmd,
    dateLabel: range.labelDisplay,
    generatedAt: now.toISOString(),
    submittedCount,
    missingCount,
    errorCount,
    orgs: view === "company" ? orgs : undefined,
    projectGroups: view === "project" ? projectGroups : undefined,
  };
}

export { PROJECT_GROUPS };
