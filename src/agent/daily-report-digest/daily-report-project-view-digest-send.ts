import { logStructured } from "../../infra/logger";
import { buildDailyReportsPublicUrlForDingtalkOutbound } from "./daily-report-workbench-link";
import {
  fallbackProjectViewMorningSummary,
  loadDailyReportMorningLlmConfig,
  summarizeProjectViewMorningWithLlm,
} from "./daily-report-project-view-morning-llm";
import { renderProjectViewMorningMarkdown } from "./daily-report-project-view-morning-render";
import type { ProjectViewDigestContext } from "./daily-report-project-view-digest-collect";
import type { ReportTimeRange } from "./daily-report-window";
import {
  hasProjectViewDigestSent,
  markProjectViewDigestSent,
  type ProjectViewDigestStateStore,
} from "./daily-report-project-view-digest-state";

export async function fetchDingTalkAccessToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  const appKey = process.env.DINGTALK_CLIENT_ID?.trim();
  const appSecret = process.env.DINGTALK_CLIENT_SECRET?.trim();
  if (!appKey || !appSecret) throw new Error("missing DINGTALK credentials");
  const res = await fetchImpl("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey, appSecret }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  const token = String(data.accessToken ?? data.access_token ?? "").trim();
  if (!token) throw new Error(`token failed: ${JSON.stringify(data)}`);
  return token;
}

export async function sendProjectViewMorningDigestRobot(params: {
  accessToken: string;
  robotCode: string;
  userId: string;
  title: string;
  markdown: string;
  detailUrl: string;
  singleTitle?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const res = await fetchImpl("https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend", {
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
        singleTitle: params.singleTitle?.trim() || "打开工作台日报",
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

export interface ProjectViewMorningDigestSendResult {
  userId: string;
  skipped?: boolean;
  skipReason?: string;
  robotMessageKey?: string;
  submittedCount: number;
  rosterCount: number;
}

export async function buildProjectViewMorningDigestPayload(
  ctx: ProjectViewDigestContext,
  range: ReportTimeRange,
  fetchImpl: typeof fetch = fetch,
): Promise<{ title: string; markdown: string; detailUrl: string; submittedCount: number; rosterCount: number }> {
  const dateLabel = `${range.labelDisplay}（${range.labelYmd}）`;
  const submittedCount = ctx.orgDigest.submitted.length;
  // 项目视图的相关人员由当天实际命中的日志决定，不能展示全员日报池人数。
  const relevantPeopleCount = submittedCount;
  const llmConfig = loadDailyReportMorningLlmConfig();
  const summary = llmConfig
    ? await summarizeProjectViewMorningWithLlm(
        ctx.view.label,
        dateLabel,
        relevantPeopleCount,
        ctx.orgDigest,
        llmConfig,
        fetchImpl,
      )
    : fallbackProjectViewMorningSummary(
        ctx.view.label,
        dateLabel,
        relevantPeopleCount,
        ctx.orgDigest,
      );

  const workbenchUrl = buildDailyReportsPublicUrlForDingtalkOutbound({
    dateYmd: range.labelYmd,
    view: `custom:${ctx.view.id}`,
  });

  const rendered = renderProjectViewMorningMarkdown({
    viewLabel: ctx.view.label,
    dateLabel,
    dateYmd: range.labelYmd,
    summary,
    submittedCount,
    rosterCount: relevantPeopleCount,
    orgDigest: ctx.orgDigest,
    workbenchUrl: workbenchUrl || undefined,
  });

  const detailUrl =
    workbenchUrl || process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL || "https://example.com";

  return {
    title: rendered.title,
    markdown: rendered.text,
    detailUrl,
    submittedCount,
    rosterCount: relevantPeopleCount,
  };
}

export async function sendProjectViewMorningDigestToUser(params: {
  ctx: ProjectViewDigestContext;
  range: ReportTimeRange;
  userId: string;
  stateStore: ProjectViewDigestStateStore;
  dryRun?: boolean;
  /** 仅用于人工预览重发；定时发送仍保持按日期去重。 */
  skipStateDedup?: boolean;
  previewTitleSuffix?: string;
  fetchImpl?: typeof fetch;
  accessToken?: string;
  robotCode?: string;
}): Promise<ProjectViewMorningDigestSendResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const viewId = params.ctx.view.id;
  const dateYmd = params.range.labelYmd;
  const userId = params.userId.trim();

  if (!params.skipStateDedup && hasProjectViewDigestSent(viewId, dateYmd, userId, params.stateStore)) {
    return {
      userId,
      skipped: true,
      skipReason: "already_sent",
      submittedCount: params.ctx.orgDigest.submitted.length,
      rosterCount: params.ctx.rosterCount,
    };
  }

  const payload = await buildProjectViewMorningDigestPayload(params.ctx, params.range, fetchImpl);

  if (params.dryRun) {
    return {
      userId,
      submittedCount: payload.submittedCount,
      rosterCount: payload.rosterCount,
    };
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
    fetchImpl,
  });

  markProjectViewDigestSent(viewId, dateYmd, userId, params.stateStore);

  logStructured({
    event: "daily_report_project_view_digest_sent",
    viewId,
    dateYmd,
    userId,
    submittedCount: payload.submittedCount,
    rosterCount: payload.rosterCount,
    robotMessageKey: robotKey,
  });

  return {
    userId,
    robotMessageKey: robotKey,
    submittedCount: payload.submittedCount,
    rosterCount: payload.rosterCount,
  };
}
