import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentMetricsStore } from "../../infra/agent-metrics-store";
import { localDayUtcRange, resolveMetricsTimezone } from "../../infra/metrics-day-bounds";
import { queryWorkbenchUsageCounts } from "../../infra/workbench-usage-stats";
import { createWorkbenchFormalTaskStore } from "../../infra/workbench-formal-task-store";
import { resolveEvalHistoryPath } from "../../infra/eval-history";
import { addDaysToYmd, formatDateInTz } from "../reminders/reminder-policy";
import { buildWeekSpanRange } from "../weekly-dashboard/week-range";

export interface OpsDashboardFacts {
  generatedAt: string;
  week: { mondayYmd: string; sundayYmd: string };
  kpi: {
    dau: number;
    wau: number;
    dauDate: string;
    turnCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    avgLoopMs: number;
    p90LoopMs: number;
    incidentCount: Record<string, number>;
    tasksPublished: number;
    workbench: {
      dau: number;
      wau: number;
      manager: { dau: number; wau: number };
      employee: { dau: number; wau: number };
    };
    evalHealth: {
      lastReleaseOk?: boolean;
      lastReleaseAt?: string;
      criticalOk?: boolean;
    };
    qualitySampledCount?: number;
    qualityPassRate?: number;
    judgePassRate?: number;
  };
  dailyTrend: Array<{
    date: string;
    turnCount: number;
    promptTokens: number;
    completionTokens: number;
  }>;
  byChannel: Array<{ channel: string; turnCount: number; tokens: number }>;
  byUser: Array<{ userId: string; turnCount: number; tokens: number }>;
  incidents: Array<{ traceId: string; userId: string; occurredAt: string; flags: string[] }>;
  qualityFails: Array<{ traceId: string; userId: string; occurredAt: string; reasons: string[] }>;
  evalCandidates: Array<{ id: string; traceId: string; createdAt: string; failReasons: string[] }>;
  evalRuns: Array<Record<string, unknown>>;
}

function loadEvalRuns(limit = 10): Array<Record<string, unknown>> {
  const path = resolveEvalHistoryPath();
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return lines
    .slice(-limit)
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .reverse();
}

function listYmdRange(fromYmd: string, toYmd: string): string[] {
  const out: string[] = [];
  let cur = fromYmd;
  while (cur <= toYmd) {
    out.push(cur);
    cur = addDaysToYmd(cur, 1);
  }
  return out;
}

function buildDailyTrendFromTurns(
  turns: Array<{
    occurredAt?: string;
    promptTokens?: number;
    completionTokens?: number;
  }>,
  timezone: string,
  fromYmd: string,
  toYmd: string,
): OpsDashboardFacts["dailyTrend"] {
  const byDate = new Map<string, { turnCount: number; promptTokens: number; completionTokens: number }>();
  for (const ymd of listYmdRange(fromYmd, toYmd)) {
    byDate.set(ymd, { turnCount: 0, promptTokens: 0, completionTokens: 0 });
  }
  for (const t of turns) {
    const raw = t.occurredAt?.trim();
    if (!raw) continue;
    const ymd = formatDateInTz(raw, timezone);
    if (!byDate.has(ymd)) continue;
    const agg = byDate.get(ymd)!;
    agg.turnCount += 1;
    agg.promptTokens += Number(t.promptTokens ?? 0);
    agg.completionTokens += Number(t.completionTokens ?? 0);
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, ...v }));
}

export function buildOpsDashboardFacts(input: {
  weekYmd?: string;
  span?: number;
  timezone?: string;
}): OpsDashboardFacts {
  const timezone = input.timezone?.trim() || resolveMetricsTimezone();
  const span = Math.max(1, Math.min(4, input.span ?? 1));
  const anchor =
    input.weekYmd?.trim() ||
    formatDateInTz(new Date().toISOString(), timezone);

  const weekSpan = buildWeekSpanRange({
    centerWeek: anchor,
    span: span - 1,
    timezone,
  });
  const fromIso = weekSpan.rangeStartIso;
  const toIso = weekSpan.rangeEndIso;
  const fromYmd = weekSpan.rangeStartYmd;
  const lastWeek = weekSpan.weeks[weekSpan.weeks.length - 1] ?? weekSpan.center;
  const sundayYmd = addDaysToYmd(lastWeek.mondayYmd, 6);

  const metrics = getAgentMetricsStore();
  const turns = metrics.queryTurnMetrics(fromIso, toIso, 5000);
  const agg = metrics.aggregateTurnStats(fromIso, toIso);

  const incidents: Record<string, number> = {};
  const byChannel = new Map<string, { turnCount: number; tokens: number }>();
  const byUser = new Map<string, { turnCount: number; tokens: number }>();

  for (const t of turns) {
    const ch = t.channel || "unknown";
    if (!byChannel.has(ch)) byChannel.set(ch, { turnCount: 0, tokens: 0 });
    const cagg = byChannel.get(ch)!;
    cagg.turnCount += 1;
    cagg.tokens += Number(t.promptTokens ?? 0) + Number(t.completionTokens ?? 0);
    if (!byUser.has(t.userId)) byUser.set(t.userId, { turnCount: 0, tokens: 0 });
    const uagg = byUser.get(t.userId)!;
    uagg.turnCount += 1;
    uagg.tokens += Number(t.promptTokens ?? 0) + Number(t.completionTokens ?? 0);
    for (const f of t.flags ?? []) {
      incidents[f] = (incidents[f] ?? 0) + 1;
    }
  }

  const wau = metrics.countDistinctUsers(fromIso, toIso);
  const dauDate = anchor;
  const { fromIso: dauFromIso, toIso: dauToIso } = localDayUtcRange(dauDate, timezone);
  const dau = metrics.countDistinctUsers(dauFromIso, dauToIso);
  const workbench = queryWorkbenchUsageCounts({
    dayFromIso: dauFromIso,
    dayToIso: dauToIso,
    weekFromIso: fromIso,
    weekToIso: toIso,
  });

  const taskStore = createWorkbenchFormalTaskStore();
  const tasksPublished = taskStore.listAdminTasks().filter((t) => {
    const ms = Date.parse(t.publishedAt);
    return ms >= Date.parse(fromIso) && ms < Date.parse(toIso);
  }).length;

  const evalRuns = loadEvalRuns(8);
  const lastRelease = evalRuns.find((r) => r.suite === "release");
  const qualitySummary = metrics.queryQualitySummary(fromIso, toIso);
  const qualityPassRate =
    qualitySummary.sampled > 0
      ? (qualitySummary.sampled - qualitySummary.qualityFail) / qualitySummary.sampled
      : undefined;
  const judgePassRate =
    qualitySummary.judgeScored > 0
      ? (qualitySummary.judgeScored - qualitySummary.judgeFail) / qualitySummary.judgeScored
      : undefined;

  const incidentRows = turns
    .filter((t) => (t.flags?.length ?? 0) > 0)
    .slice(0, 30)
    .map((t) => ({
      traceId: t.traceId,
      userId: t.userId,
      occurredAt: t.occurredAt ?? "",
      flags: t.flags ?? [],
    }));

  const qualityFailRows = turns
    .filter((t) => t.outcome === "quality_fail")
    .slice(0, 30)
    .map((t) => {
      const qs = t.qualityScores as { reasons?: string[] } | undefined;
      return {
        traceId: t.traceId,
        userId: t.userId,
        occurredAt: t.occurredAt ?? "",
        reasons: qs?.reasons ?? [],
      };
    });

  const evalCandidates = metrics.listEvalCandidates("pending", 20).map((c) => ({
    id: c.id,
    traceId: c.traceId,
    createdAt: c.createdAt,
    failReasons: c.failReasons.slice(0, 5),
  }));

  return {
    generatedAt: new Date().toISOString(),
    week: { mondayYmd: fromYmd, sundayYmd },
    kpi: {
      dau,
      wau,
      dauDate,
      turnCount: agg.turnCount,
      promptTokens: agg.promptTokens,
      completionTokens: agg.completionTokens,
      totalTokens: agg.promptTokens + agg.completionTokens,
      avgLoopMs: agg.avgLoopMs,
      p90LoopMs: agg.p90LoopMs,
      incidentCount: incidents,
      tasksPublished,
      workbench,
      evalHealth: {
        lastReleaseOk: lastRelease?.allOk as boolean | undefined,
        lastReleaseAt: lastRelease?.startedAt as string | undefined,
        criticalOk: lastRelease?.criticalOk as boolean | undefined,
      },
      qualitySampledCount: qualitySummary.sampled,
      qualityPassRate,
      judgePassRate,
    },
    dailyTrend: buildDailyTrendFromTurns(turns, timezone, fromYmd, sundayYmd),
    byChannel: [...byChannel.entries()].map(([channel, v]) => ({ channel, ...v })),
    byUser: [...byUser.entries()]
      .map(([userId, v]) => ({ userId, ...v }))
      .sort((a, b) => b.turnCount - a.turnCount)
      .slice(0, 20),
    incidents: incidentRows,
    qualityFails: qualityFailRows,
    evalCandidates,
    evalRuns,
  };
}
