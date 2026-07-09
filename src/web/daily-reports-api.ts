import { loadDailyReportDigestConfig } from "../agent/daily-report-digest/daily-report-config";
import { collectOrgDigests } from "../agent/daily-report-digest/daily-report-run";
import type { OrgDigest } from "../agent/daily-report-digest/daily-report-build";
import {
  groupOrgDigestsByProject,
  listProjectGroupAssignmentsFromConfig,
  PROJECT_GROUPS,
  type ProjectGroupId,
} from "../agent/daily-report-digest/daily-report-project-groups";
import {
  createProjectViewCacheStore,
  deleteProjectViewCache,
  getProjectViewCache,
} from "../agent/daily-report-digest/daily-report-project-view-cache";
import {
  createDayPartitionCacheStore,
  deleteDayPartitionCache,
  loadOrCollectUnifiedDay,
} from "../agent/daily-report-digest/daily-report-day-partition-cache";
import { listProjectViewsFromConfig } from "../agent/daily-report-digest/daily-report-project-views";
import {
  findProjectViewById,
  resolveDailyReportsAccess,
  type DailyReportsAccessInfo,
  type WorkbenchDailyReportsCaps,
} from "../agent/daily-report-digest/daily-report-project-views";
import {
  ensureProjectViewPersonBriefs,
  personBriefsToMap,
  resolvePersonBriefForEmployee,
} from "../agent/daily-report-digest/daily-report-project-view-person-briefs";
import {
  createProjectViewRosterStore,
  listProjectViewRoster,
} from "../agent/daily-report-digest/daily-report-project-view-roster-store";
import {
  resolveDayRangeForYmd,
  resolveReportRange,
} from "../agent/daily-report-digest/daily-report-window";
import type { DailyReportsViewMode } from "../agent/daily-report-digest/daily-report-workbench-link";
import {
  buildOpenReportInDingtalkPayload,
} from "../agent/daily-report-digest/daily-report-dingtalk-report-link";
import type { ReportAttachment } from "../agent/daily-report-digest/daily-report-attachments";
import { reportHasResolvableImages } from "../agent/daily-report-digest/daily-report-attachments";
import type { ReportEntry } from "../agent/daily-report-digest/dingtalk-report-client";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDailyReportPagePersonBriefsLlmEnabled(): boolean {
  const raw = String(process.env.DAILY_REPORT_PAGE_PERSON_BRIEFS_LLM ?? "1")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export interface DailyReportsReportPayload {
  reportId?: string;
  creatorUserId?: string;
  templateName: string;
  createTime: number;
  openInDingtalkUrl?: string;
  openInDingtalkOpenApp?: string;
  openInDingtalkH5Url?: string;
  openInDingtalkClientLink?: string;
  hasInlineImages?: boolean;
  contents: Array<{
    key: string;
    value: string;
    type?: string;
    attachments?: Array<{ name: string; url?: string; fileId?: string; spaceId?: string }>;
  }>;
  images?: Array<{ name: string; url?: string; fileId?: string; spaceId?: string }>;
}

export interface DailyReportsOrgPayload {
  label: string;
  submitted: Array<{
    userid: string;
    name: string;
    brief?: string;
    projectGroup?: ProjectGroupId;
    reports: DailyReportsReportPayload[];
  }>;
  missing: Array<{ userid: string; name: string; projectGroup?: ProjectGroupId }>;
  onLeave: Array<{ userid: string; name: string; projectGroup?: ProjectGroupId }>;
  errors: Array<{ userid: string; name: string; reason: string }>;
}

export interface DailyReportsProjectGroupPayload {
  id: ProjectGroupId;
  label: string;
  orgs: DailyReportsOrgPayload[];
}

export interface DailyReportsCustomProjectViewPayload {
  id: string;
  label: string;
  orgLabel: string;
  orgs: DailyReportsOrgPayload[];
}

export interface DailyReportsHttpPayload {
  ok: boolean;
  error?: string;
  configured?: boolean;
  view?: DailyReportsViewMode;
  access?: DailyReportsAccessInfo;
  date?: string;
  dateLabel?: string;
  generatedAt?: string;
  submittedCount?: number;
  missingCount?: number;
  onLeaveCount?: number;
  errorCount?: number;
  orgs?: DailyReportsOrgPayload[];
  projectGroups?: DailyReportsProjectGroupPayload[];
  customProjectView?: DailyReportsCustomProjectViewPayload;
  scanning?: boolean;
  rosterCount?: number;
  /** 当日研发/关键词命中模板提交人数（统一日筛） */
  poolCount?: number;
  cacheScannedAt?: string;
  /** 本次为 roster 快扫（未写全员缓存）；点刷新可拉全量 */
  partialScan?: boolean;
}

function mapAttachment(a: ReportAttachment): ReportAttachment {
  return {
    name: a.name,
    ...(a.url ? { url: a.url } : {}),
    ...(a.fileId ? { fileId: a.fileId } : {}),
    ...(a.spaceId ? { spaceId: a.spaceId } : {}),
  };
}

function mapReportPayload(r: ReportEntry): DailyReportsReportPayload {
  const links = buildOpenReportInDingtalkPayload({
    reportId: r.reportId,
    creatorUserId: r.creatorUserId,
    createTime: r.createTime,
  });
  return {
    reportId: r.reportId,
    creatorUserId: r.creatorUserId,
    templateName: r.templateName,
    createTime: r.createTime,
    openInDingtalkUrl: links?.openInDingtalkUrl,
    openInDingtalkOpenApp: links?.openInDingtalkOpenApp,
    openInDingtalkH5Url: links?.openInDingtalkH5Url,
    openInDingtalkClientLink: links?.openInDingtalkClientLink,
    hasInlineImages: reportHasResolvableImages(r),
    contents: r.contents.map((c) => ({
      key: c.key,
      value: c.value,
      type: c.type,
      attachments: c.attachments?.map(mapAttachment),
    })),
    images: r.images?.map(mapAttachment),
  };
}

function mapOrgDigest(
  org: Awaited<ReturnType<typeof collectOrgDigests>>["orgDigests"][0],
  assignments: Map<string, ProjectGroupId>,
  briefByName?: Map<string, string>,
): DailyReportsOrgPayload {
  return {
    label: org.label,
    submitted: org.submitted.map((emp) => {
      const brief = briefByName
        ? resolvePersonBriefForEmployee(emp.name, emp.userid, briefByName)
        : undefined;
      return {
        userid: emp.userid,
        name: emp.name,
        ...(brief ? { brief } : {}),
        projectGroup: assignments.get(emp.userid),
        reports: emp.reports.map(mapReportPayload),
      };
    }),
    missing: org.missing.map((m) => ({
      userid: m.userid,
      name: m.name,
      projectGroup: assignments.get(m.userid),
    })),
    onLeave: (org.onLeave ?? []).map((m) => ({
      userid: m.userid,
      name: m.name,
      projectGroup: assignments.get(m.userid),
    })),
    errors: org.errors,
  };
}

export function parseDailyReportsViewParam(raw: unknown): DailyReportsViewMode {
  const v = String(raw ?? "").trim();
  if (v.toLowerCase() === "company") return "company";
  if (v.startsWith("custom:")) return v as DailyReportsViewMode;
  return "project";
}

function parseCustomViewId(view: DailyReportsViewMode): string | undefined {
  if (!view.startsWith("custom:")) return undefined;
  const id = view.slice("custom:".length).trim();
  return id || undefined;
}

function resolveDefaultView(access: DailyReportsAccessInfo): DailyReportsViewMode {
  if (access.customOnly && access.customViews[0]) {
    return `custom:${access.customViews[0].id}`;
  }
  return "project";
}

/**
 * 工作台「跨组织日报」页面的数据源：实时拉取各组织目标员工某天的钉钉日志并聚合。
 */
export async function buildDailyReportsHttpPayload(input?: {
  date?: string;
  view?: DailyReportsViewMode;
  userId?: string;
  caps?: WorkbenchDailyReportsCaps;
  now?: Date;
  fetchImpl?: typeof fetch;
  refresh?: boolean;
}): Promise<DailyReportsHttpPayload> {
  const { config, errors } = loadDailyReportDigestConfig();
  if (errors.length > 0) {
    return {
      ok: false,
      configured: false,
      error: `日报功能未配置或配置无效：${errors.join("；")}`,
    };
  }

  const caps: WorkbenchDailyReportsCaps = input?.caps ?? {
    canAccessAdmin: false,
    canManage: true,
  };
  const access = input?.userId
    ? resolveDailyReportsAccess(input.userId, config, caps)
    : { legacyAccess: true, customOnly: false, customViews: [] };

  let view = input?.view ? parseDailyReportsViewParam(input.view) : resolveDefaultView(access);
  if (access.customOnly) {
    const allowed = new Set(access.customViews.map((v) => v.id));
    const customId = parseCustomViewId(view);
    if (!customId || !allowed.has(customId)) {
      view = resolveDefaultView(access);
    }
  } else if (!access.legacyAccess && parseCustomViewId(view) == null) {
    view = resolveDefaultView(access);
  }

  const now = input?.now ?? new Date();
  const date = input?.date?.trim();
  if (date && !YMD_RE.test(date)) {
    return { ok: false, error: `非法日期格式：${date}（应为 YYYY-MM-DD）` };
  }
  const cutoffOpts = {
    cutoffHour: config.reportDayCutoffHour,
    cutoffMinute: config.reportDayCutoffMinute,
  };
  const range = date
    ? resolveDayRangeForYmd(date, config.timezone, cutoffOpts)
    : resolveReportRange(now, config.timezone, cutoffOpts);

  const customViewId = parseCustomViewId(view);
  if (customViewId) {
    const viewDef = findProjectViewById(config, customViewId);
    if (!viewDef) {
      return { ok: false, error: `未知项目组视图：${customViewId}` };
    }
    if (
      input?.userId
      && !viewDef.viewers.includes(input.userId)
      && !caps.canAccessAdmin
      && !access.legacyAccess
    ) {
      return { ok: false, error: "无权查看此项目组视图" };
    }
    const org = config.orgs.find((o) => o.label === viewDef.orgLabel);
    if (!org) {
      return { ok: false, error: `视图关联组织不存在：${viewDef.orgLabel}` };
    }

    const refresh = input?.refresh === true;
    const cacheStore = createProjectViewCacheStore();
    const partitionStore = createDayPartitionCacheStore();
    const rosterStore = createProjectViewRosterStore();
    try {
      if (refresh) {
        deleteDayPartitionCache(org.label, range.labelYmd, partitionStore);
        for (const v of listProjectViewsFromConfig([org])) {
          deleteProjectViewCache(v.id, range.labelYmd, cacheStore);
        }
      }

      const rosterCount = listProjectViewRoster(customViewId, rosterStore).length;
      const cached = refresh ? null : getProjectViewCache(customViewId, range.labelYmd, cacheStore);
      if (cached) {
        const digest: OrgDigest = {
          label: org.label,
          submitted: cached.payload.submitted,
          missing: [],
          onLeave: [],
          errors: cached.payload.errors,
        };
        const orgPayload = mapOrgDigest(digest, new Map());
        return {
          ok: true,
          configured: true,
          view,
          access,
          date: range.labelYmd,
          dateLabel: range.labelDisplay,
          generatedAt: now.toISOString(),
          submittedCount: orgPayload.submitted.length,
          missingCount: 0,
          onLeaveCount: 0,
          errorCount: orgPayload.errors.length,
          rosterCount,
          poolCount: rosterCount,
          cacheScannedAt: cached.scannedAt,
          partialScan: false,
          scanning: false,
          customProjectView: {
            id: viewDef.id,
            label: viewDef.label,
            orgLabel: viewDef.orgLabel,
            orgs: [orgPayload],
          },
        };
      }

      if (rosterCount === 0) {
        const digest: OrgDigest = {
          label: org.label,
          submitted: [],
          missing: [],
          onLeave: [],
          errors: [],
        };
        return {
          ok: true,
          configured: true,
          view,
          access,
          date: range.labelYmd,
          dateLabel: range.labelDisplay,
          generatedAt: now.toISOString(),
          submittedCount: 0,
          missingCount: 0,
          onLeaveCount: 0,
          errorCount: 0,
          rosterCount: 0,
          poolCount: 0,
          partialScan: true,
          scanning: true,
          customProjectView: {
            id: viewDef.id,
            label: viewDef.label,
            orgLabel: viewDef.orgLabel,
            orgs: [mapOrgDigest(digest, new Map())],
          },
        };
      }

      const unified = await loadOrCollectUnifiedDay({
        org,
        range,
        refresh,
        scanMode: "fast",
        partitionStore,
        projectViewCacheStore: cacheStore,
        rosterStore,
        ownsPartitionStore: false,
        ownsProjectViewCacheStore: false,
        ownsRosterStore: false,
        fetchImpl: input?.fetchImpl,
      });

      const poolCount = unified.poolCount;
      const digest: OrgDigest =
        unified.byViewId.get(customViewId) ?? {
          label: org.label,
          submitted: [],
          missing: [],
          onLeave: [],
          errors: unified.errors,
        };

      const updatedCache = getProjectViewCache(customViewId, range.labelYmd, cacheStore);
      const briefs = await ensureProjectViewPersonBriefs({
        viewId: customViewId,
        viewLabel: viewDef.label,
        dateYmd: range.labelYmd,
        dateLabel: range.labelDisplay,
        rosterCount: poolCount,
        orgDigest: digest,
        cacheStore,
        fetchImpl: input?.fetchImpl,
        refresh,
        llmEnabled: isDailyReportPagePersonBriefsLlmEnabled(),
      });
      const orgPayload = mapOrgDigest(digest, new Map(), personBriefsToMap(briefs));
      return {
        ok: true,
        configured: true,
        view,
        access,
        date: range.labelYmd,
        dateLabel: range.labelDisplay,
        generatedAt: now.toISOString(),
        submittedCount: orgPayload.submitted.length,
        missingCount: 0,
        onLeaveCount: 0,
        errorCount: orgPayload.errors.length,
        rosterCount,
        poolCount,
        cacheScannedAt: unified.scannedAt ?? updatedCache?.scannedAt,
        partialScan: !unified.fromCache && unified.scanMode === "fast",
        scanning: false,
        customProjectView: {
          id: viewDef.id,
          label: viewDef.label,
          orgLabel: viewDef.orgLabel,
          orgs: [orgPayload],
        },
      };
    } finally {
      rosterStore.close();
      partitionStore.close();
      cacheStore.close();
    }
  }

  if (!access.legacyAccess) {
    return { ok: false, error: "无权查看公司/项目视图" };
  }

  const { orgDigests, errorCount } = await collectOrgDigests(config, range, {
    fetchImpl: input?.fetchImpl,
  });

  const assignmentsList = listProjectGroupAssignmentsFromConfig(config.orgs);
  const assignmentMap = new Map(assignmentsList.map((a) => [a.userid, a.projectGroup]));

  let submittedCount = 0;
  let missingCount = 0;
  let onLeaveCount = 0;
  const orgs = orgDigests.map((org) => {
    submittedCount += org.submitted.length;
    missingCount += org.missing.length;
    onLeaveCount += (org.onLeave ?? []).length;
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
    access,
    date: range.labelYmd,
    dateLabel: range.labelDisplay,
    generatedAt: now.toISOString(),
    submittedCount,
    missingCount,
    onLeaveCount,
    errorCount,
    orgs: view === "company" ? orgs : undefined,
    projectGroups: view === "project" ? projectGroups : undefined,
  };
}

export { PROJECT_GROUPS };
