import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentMetricsStore } from "../../infra/agent-metrics-store";
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
    turnCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    avgLoopMs: number;
    p90LoopMs: number;
    incidentCount: Record<string, number>;
    tasksPublished: number;
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

function mondayOfWeekYmd(weekYmd: string, timezone: string): string {
  const d = new Date(`${weekYmd}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return formatDateInTz(new Date().toISOString(), timezone);
  }
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
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

export function buildOpsDashboardFacts(input: {
  weekYmd?: string;
  span?: number;
  timezone?: string;
}): OpsDashboardFacts {
  const timezone = input.timezone?.trim() || process.env.WEEKLY_DASHBOARD_TIMEZONE?.trim() || "Asia/Shanghai";
  const span = Math.max(1, Math.min(4, input.span ?? 1));
  const anchor =
    input.weekYmd?.trim() ||
    formatDateInTz(new Date().toISOString(), timezone);
  const monday = mondayOfWeekYmd(anchor, timezone);
  const weekSpan = buildWeekSpanRange({
    centerWeek: monday,
    span: span - 1,
    timezone,
  });
  const fromIso = weekSpan.rangeStartIso;
  const toIso = weekSpan.rangeEndIso;
  const fromYmd = fromIso.slice(0, 10);
  const toYmd = addDaysToYmd(toIso.slice(0, 10), -1);

  const metrics = getAgentMetricsStore();
  const daily = metrics.queryUsageDaily(fromYmd, toYmd);
  const turns = metrics.queryTurnMetrics(fromIso, toIso, 2000);

  let turnCount = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  const loops: number[] = [];
  const incidents: Record<string, number> = {};
  const byChannel = new Map<string, { turnCount: number; tokens: number }>();
  const byUser = new Map<string, { turnCount: number; tokens: number }>();

  for (const t of turns) {
    turnCount += 1;
    promptTokens += Number(t.promptTokens ?? 0);
    completionTokens += Number(t.completionTokens ?? 0);
    if (t.loopMs != null) loops.push(t.loopMs);
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
  const lastDay = toYmd;
  const dau =
    daily.find((d) => d.date === lastDay)?.activeUsers
    ?? metrics.countDistinctUsers(`${lastDay}T00:00:00.000Z`, `${lastDay}T23:59:59.999Z`);

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
    week: { mondayYmd: fromYmd, sundayYmd: toYmd },
    kpi: {
      dau,
      wau,
      turnCount,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      avgLoopMs: loops.length ? loops.reduce((s, v) => s + v, 0) / loops.length : 0,
      p90LoopMs: loops.length
        ? [...loops].sort((a, b) => a - b)[Math.ceil(loops.length * 0.9) - 1] ?? 0
        : 0,
      incidentCount: incidents,
      tasksPublished,
      evalHealth: {
        lastReleaseOk: lastRelease?.allOk as boolean | undefined,
        lastReleaseAt: lastRelease?.startedAt as string | undefined,
        criticalOk: lastRelease?.criticalOk as boolean | undefined,
      },
      qualitySampledCount: qualitySummary.sampled,
      qualityPassRate,
      judgePassRate,
    },
    dailyTrend: daily.map((d) => ({
      date: d.date,
      turnCount: d.turnCount,
      promptTokens: d.promptTokens,
      completionTokens: d.completionTokens,
    })),
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
