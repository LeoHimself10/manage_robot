import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createAgentMetricsStore,
  resetAgentMetricsStoreForTests,
} from "../../src/infra/agent-metrics-store";
import {
  createWorkbenchActivityStore,
  resetWorkbenchActivityStoreForTests,
} from "../../src/infra/workbench-activity-store";
import { buildOpsDashboardFacts } from "../../src/agent/ops-dashboard/ops-dashboard-facts";
import { zonedMidnightUtcIso } from "../../src/agent/reminders/reminder-policy";

describe("buildOpsDashboardFacts", () => {
  let dbPath = "";

  beforeEach(() => {
    vi.unstubAllEnvs();
    resetAgentMetricsStoreForTests();
    resetWorkbenchActivityStoreForTests();
    dbPath = join(tmpdir(), `ops-facts-${Date.now()}.sqlite`);
    mkdirSync(join(dbPath, ".."), { recursive: true });
    vi.stubEnv("WORKBENCH_SQLITE_PATH", dbPath);
    vi.stubEnv("WEEKLY_DASHBOARD_TIMEZONE", "Asia/Shanghai");
  });

  afterEach(() => {
    resetAgentMetricsStoreForTests();
    resetWorkbenchActivityStoreForTests();
    vi.unstubAllEnvs();
    try {
      rmSync(dbPath, { force: true });
    } catch {
      // ignore
    }
  });

  it("counts agent DAU on anchor day, not Sunday of week", () => {
    const metrics = createAgentMetricsStore(dbPath);
    const tz = "Asia/Shanghai";
    const todayYmd = "2026-06-02";
    const tuesdayNoon = new Date(
      Date.parse(zonedMidnightUtcIso(todayYmd, tz)) + 4 * 60 * 60 * 1000,
    ).toISOString();
    const sundayYmd = "2026-06-07";
    const sundayNoon = new Date(
      Date.parse(zonedMidnightUtcIso(sundayYmd, tz)) + 4 * 60 * 60 * 1000,
    ).toISOString();

    metrics.insertTurnMetric({
      traceId: "trace-tue",
      userId: "u-yao",
      channel: "dingtalk",
      occurredAt: tuesdayNoon,
    });
    metrics.insertTurnMetric({
      traceId: "trace-sun",
      userId: "u-other",
      channel: "dingtalk",
      occurredAt: sundayNoon,
    });

    const facts = buildOpsDashboardFacts({ weekYmd: todayYmd, span: 1, timezone: tz });

    expect(facts.kpi.dauDate).toBe(todayYmd);
    expect(facts.kpi.dau).toBe(1);
    expect(facts.kpi.wau).toBe(2);
    expect(facts.week.mondayYmd).toBe("2026-06-01");
    expect(facts.week.sundayYmd).toBe("2026-06-07");
  });

  it("splits workbench usage by manager vs employee", () => {
    const activity = createWorkbenchActivityStore(dbPath);
    const tz = "Asia/Shanghai";
    const day = "2026-06-02";
    const noon = new Date(
      Date.parse(zonedMidnightUtcIso(day, tz)) + 5 * 60 * 60 * 1000,
    ).toISOString();

    activity.recordEvent({
      userId: "mgr-1",
      surface: "manager",
      path: "/workbench/manager/tasks",
      kind: "page_view",
      occurredAt: noon,
    });
    activity.recordEvent({
      userId: "adm-1",
      surface: "admin",
      path: "/workbench/admin/ops",
      kind: "page_view",
      occurredAt: noon,
    });
    activity.recordEvent({
      userId: "emp-1",
      surface: "employee",
      path: "/workbench/employee",
      kind: "agent_turn",
      occurredAt: noon,
    });

    const facts = buildOpsDashboardFacts({ weekYmd: day, span: 1, timezone: tz });
    const wb = facts.kpi.workbench;

    expect(wb.dau).toBe(3);
    expect(wb.manager.dau).toBe(2);
    expect(wb.employee.dau).toBe(1);
    expect(wb.wau).toBe(3);
  });

  it("uses SQL aggregate for turnCount beyond queryTurnMetrics sample", () => {
    const metrics = createAgentMetricsStore(dbPath);
    const tz = "Asia/Shanghai";
    const day = "2026-06-02";
    const base = Date.parse(zonedMidnightUtcIso(day, tz));
    for (let i = 0; i < 12; i += 1) {
      metrics.insertTurnMetric({
        traceId: `trace-${i}`,
        userId: `u-${i}`,
        channel: "dingtalk",
        occurredAt: new Date(base + (i + 1) * 60_000).toISOString(),
        promptTokens: 10,
        completionTokens: 5,
      });
    }

    const facts = buildOpsDashboardFacts({ weekYmd: day, span: 1, timezone: tz });
    expect(facts.kpi.turnCount).toBe(12);
    expect(facts.kpi.promptTokens).toBe(120);
    expect(facts.kpi.completionTokens).toBe(60);
  });
});
