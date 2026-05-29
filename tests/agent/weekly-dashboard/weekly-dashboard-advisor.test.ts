import { afterEach, describe, expect, it } from "vitest";
import { __setWeeklyAdvisorLlmForTest, summarizeWeeklyAdvisorWithLlm } from "../../../src/agent/weekly-dashboard/weekly-dashboard-advisor-llm";
import { renderWeeklyAdvisorTemplate } from "../../../src/agent/weekly-dashboard/weekly-dashboard-advisor-templates";
import type { WeeklyDashboardFacts } from "../../../src/agent/weekly-dashboard/weekly-dashboard-facts";
import type { WeeklyDashboardPolicy } from "../../../src/agent/weekly-dashboard/weekly-dashboard-policy";

const policy: WeeklyDashboardPolicy = {
  timezone: "Asia/Shanghai",
  defaultSpan: 1,
  maxSpan: 6,
  feedPageSize: 50,
  feedMaxPageSize: 100,
  advisorLlmEnabled: true,
  advisorLlmModel: "test",
  advisorLlmTimeoutMs: 20,
  advisorLlmMaxTokens: 100,
  advisorLlmBaseUrl: "http://example.test",
  advisorLlmApiKey: "key",
};

const facts = {
  week: { label: "2026-05-18 ~ 2026-05-24" },
  kpi: { completedInWeek: 1, inProgress: 2, waitingAccept: 1, blockedOrOverdue: 0, eventCount: 3, dueNextWeek: 1 },
  tasks: [],
  feed: { items: [] },
  approxHistoricalState: false,
} as unknown as WeeklyDashboardFacts;

describe("weekly dashboard advisor", () => {
  afterEach(() => {
    __setWeeklyAdvisorLlmForTest(undefined);
  });

  it("uses injected LLM response when available", async () => {
    __setWeeklyAdvisorLlmForTest(async () => ({
      renderSource: "llm",
      sections: [{ title: "判断", bullets: ["继续推进"] }],
    }));
    const result = await summarizeWeeklyAdvisorWithLlm(facts, policy);
    expect(result.renderSource).toBe("llm");
    expect(result.sections[0]?.bullets).toEqual(["继续推进"]);
  });

  it("falls back to template on timeout", async () => {
    __setWeeklyAdvisorLlmForTest(async () => new Promise((resolve) => setTimeout(() => resolve(null), 200)));
    const result = await summarizeWeeklyAdvisorWithLlm(facts, policy);
    expect(result.renderSource).toBe("template");
    expect(result.timedOut).toBe(true);
  });

  it("template summarizes progress and next-week push", () => {
    const result = renderWeeklyAdvisorTemplate(facts);
    expect(result.sections.map((s) => s.title)).toEqual(["本周进展", "下周推进建议"]);
    expect(result.sections[0]?.bullets.some((b) => b.includes("本周完成"))).toBe(true);
    expect(result.sections[1]?.bullets.length).toBeGreaterThan(0);
  });
});
