import { logStructured } from "../../infra/logger";
import { buildDailyReportsPublicUrlForDingtalkOutbound } from "./daily-report-workbench-link";
import {
  buildCtoRollupProjectLine,
  renderCtoRollupMorningMarkdown,
} from "./daily-report-cto-rollup-morning-render";
import { CTO_ROLLUP_DIGEST_STATE_VIEW_ID } from "./daily-report-cto-rollup-digest-flag";
import type { ProjectViewDigestContext } from "./daily-report-project-view-digest-collect";
import { fallbackCtoRollupOverviewSummary } from "./daily-report-project-view-morning-llm";
import { ensureProjectViewCtoOverview } from "./daily-report-project-view-summaries";
import type { ProjectViewCacheStore } from "./daily-report-project-view-cache";
import type { ReportTimeRange } from "./daily-report-window";
import {
  fetchDingTalkAccessToken,
  sendProjectViewMorningDigestRobot,
  type ProjectViewMorningDigestSendResult,
} from "./daily-report-project-view-digest-send";
import {
  hasProjectViewDigestSent,
  markProjectViewDigestSent,
  type ProjectViewDigestStateStore,
} from "./daily-report-project-view-digest-state";

export interface CtoRollupDigestQuality {
  ok: boolean;
  reasons: string[];
  errorCount: number;
}

export function countDistinctCtoRollupSubmitters(
  contexts: ProjectViewDigestContext[],
): number {
  const userIds = new Set<string>();
  for (const ctx of contexts) {
    for (const item of ctx.orgDigest.submitted) {
      const id = item.userid?.trim();
      if (id) userIds.add(id);
    }
  }
  return userIds.size;
}

export function evaluateCtoRollupDigestQuality(
  contexts: ProjectViewDigestContext[],
): CtoRollupDigestQuality {
  const reasons: string[] = [];
  const errors = contexts.flatMap((ctx) => [
    ...(ctx.collectErrors ?? []),
    ...(ctx.orgDigest.errors ?? []),
  ]);
  if (errors.length > 0) {
    reasons.push(`collection_errors:${errors.length}`);
  }
  for (const ctx of contexts) {
    if (!ctx.fromCache && ctx.scanContactCount === 0) {
      reasons.push(`empty_scan:${ctx.view.id}`);
    }
  }
  return { ok: reasons.length === 0, reasons, errorCount: errors.length };
}

export async function buildCtoRollupMorningDigestPayload(
  contexts: ProjectViewDigestContext[],
  range: ReportTimeRange,
  fetchImpl: typeof fetch = fetch,
  options?: {
    overviewByViewId?: Map<string, string>;
    cacheStore?: ProjectViewCacheStore;
  },
): Promise<{
  title: string;
  markdown: string;
  detailUrl: string;
  projectLines: ReturnType<typeof buildCtoRollupProjectLine>[];
}> {
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;
  const sorted = [...contexts].sort((a, b) =>
    a.view.label.localeCompare(b.view.label, "zh-CN"),
  );
  const overviewByViewId = options?.overviewByViewId ?? new Map<string, string>();

  const projectLines = await Promise.all(
    sorted.map(async (ctx) => {
      const submittedCount = ctx.orgDigest.submitted.length;
      let overviewLine = overviewByViewId.get(ctx.view.id);

      if (!overviewLine && options?.cacheStore) {
        overviewLine = await ensureProjectViewCtoOverview({
          viewId: ctx.view.id,
          viewLabel: ctx.view.label,
          dateYmd: range.labelYmd,
          dateLabel,
          rosterCount: ctx.rosterCount,
          orgDigest: ctx.orgDigest,
          cacheStore: options.cacheStore,
          fetchImpl,
        });
      }

      if (!overviewLine) {
        overviewLine = fallbackCtoRollupOverviewSummary(
          ctx.view.label,
          ctx.rosterCount,
          ctx.orgDigest,
        ).overview;
      }

      return buildCtoRollupProjectLine({
        viewId: ctx.view.id,
        viewLabel: ctx.view.label,
        rosterCount: ctx.rosterCount,
        submittedCount,
        overviewLine,
      });
    }),
  );

  const workbenchUrl = buildDailyReportsPublicUrlForDingtalkOutbound({
    dateYmd: range.labelYmd,
    view: "custom:overview",
  });

  const rendered = renderCtoRollupMorningMarkdown({
    dateLabel,
    dateYmd: range.labelYmd,
    projectLines,
    totalDistinctSubmittedCount: countDistinctCtoRollupSubmitters(contexts),
    workbenchUrl: workbenchUrl || undefined,
  });

  const detailUrl =
    workbenchUrl || process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL || "https://example.com";

  return {
    title: rendered.title,
    markdown: rendered.text,
    detailUrl,
    projectLines,
  };
}

export async function sendCtoRollupMorningDigestToUser(params: {
  contexts: ProjectViewDigestContext[];
  range: ReportTimeRange;
  userId: string;
  stateStore: ProjectViewDigestStateStore;
  dryRun?: boolean;
  skipStateDedup?: boolean;
  previewTitleSuffix?: string;
  fetchImpl?: typeof fetch;
  accessToken?: string;
  robotCode?: string;
  singleTitle?: string;
  overviewByViewId?: Map<string, string>;
  cacheStore?: ProjectViewCacheStore;
}): Promise<ProjectViewMorningDigestSendResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const dateYmd = params.range.labelYmd;
  const userId = params.userId.trim();
  const viewStateId = CTO_ROLLUP_DIGEST_STATE_VIEW_ID;

  const rosterCount = params.contexts.reduce((n, c) => n + c.rosterCount, 0);
  const submittedCount = params.contexts.reduce(
    (n, c) => n + c.orgDigest.submitted.length,
    0,
  );

  if (
    !params.skipStateDedup &&
    hasProjectViewDigestSent(viewStateId, dateYmd, userId, params.stateStore)
  ) {
    return {
      userId,
      skipped: true,
      skipReason: "already_sent",
      submittedCount,
      rosterCount,
    };
  }

  const quality = evaluateCtoRollupDigestQuality(params.contexts);
  if (!quality.ok) {
    logStructured({
      event: "daily_report_cto_rollup_digest_quality_failed",
      dateYmd,
      userId,
      reasons: quality.reasons,
      errorCount: quality.errorCount,
    });
    throw new Error(`cto_rollup_quality_failed: ${quality.reasons.join("; ")}`);
  }

  const payload = await buildCtoRollupMorningDigestPayload(
    params.contexts,
    params.range,
    fetchImpl,
    {
      overviewByViewId: params.overviewByViewId,
      cacheStore: params.cacheStore,
    },
  );

  if (params.dryRun) {
    return { userId, submittedCount, rosterCount };
  }

  const robotCode =
    params.robotCode?.trim() ||
    process.env.DINGTALK_ROBOT_CODE?.trim() ||
    process.env.DINGTALK_CLIENT_ID?.trim();
  if (!robotCode) throw new Error("missing DINGTALK_ROBOT_CODE or DINGTALK_CLIENT_ID");

  const accessToken = params.accessToken ?? (await fetchDingTalkAccessToken(fetchImpl));
  const titleSuffix = params.previewTitleSuffix?.trim();
  const cardTitle = titleSuffix ? `${payload.title} · ${titleSuffix}` : payload.title;

  const robotKey = await sendProjectViewMorningDigestRobot({
    accessToken,
    robotCode,
    userId,
    title: cardTitle,
    markdown: payload.markdown,
    detailUrl: payload.detailUrl,
    singleTitle: params.singleTitle?.trim() || "打开工作台 · 全部项目",
    fetchImpl,
  });

  if (!params.skipStateDedup) {
    markProjectViewDigestSent(viewStateId, dateYmd, userId, params.stateStore);
  }

  logStructured({
    event: "daily_report_cto_rollup_digest_sent",
    dateYmd,
    userId,
    projectCount: params.contexts.length,
    viewIds: params.contexts.map((c) => c.view.id),
    submittedCount,
    rosterCount,
    robotMessageKey: robotKey,
  });

  return {
    userId,
    robotMessageKey: robotKey,
    submittedCount,
    rosterCount,
  };
}
