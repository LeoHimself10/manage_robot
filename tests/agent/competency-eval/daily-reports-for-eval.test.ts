import { describe, expect, it, vi, afterEach } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";
import {
  buildEvalReportLinesFromEntries,
  fetchEmployeeDailyReportsForEval,
} from "../../../src/agent/competency-eval/daily-reports-for-eval";

const MOCK_CONFIG = parseDailyReportDigestConfig({
  timezone: "Asia/Shanghai",
  reportDayCutoffHour: 17,
  reportDayCutoffMinute: 0,
  orgs: [
    {
      label: "明思",
      appKey: "ak1",
      appSecret: "as1",
      templateName: "日报",
      employees: [{ userid: "u_a", name: "张三" }],
    },
  ],
}).config;

function report(over: Partial<ReportEntry>): ReportEntry {
  return {
    creatorUserId: "u_a",
    creatorName: "张三",
    templateName: "日报",
    createTime: Date.parse("2026-06-08T10:00:00+08:00"),
    contents: [{ key: "今日工作", value: "完成了 A 模块" }],
    ...over,
  };
}

describe("buildEvalReportLinesFromEntries", () => {
  it("formats entries sorted by createTime", () => {
    const entries = [
      report({
        createTime: Date.parse("2026-06-09T10:00:00+08:00"),
        contents: [{ key: "今日工作", value: "B" }],
      }),
      report({
        createTime: Date.parse("2026-06-08T10:00:00+08:00"),
        contents: [{ key: "今日工作", value: "A" }],
      }),
    ];
    const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(entries, 48000);
    expect(truncated).toBe(false);
    expect(reports).toHaveLength(2);
    expect(reports[0].date).toBe("2026-06-08");
    expect(reports[0].lines[0]).toContain("A");
    expect(reports[1].date).toBe("2026-06-09");
    expect(totalChars).toBeGreaterThan(0);
  });

  it("truncates when total chars exceed max", () => {
    const longText = "x".repeat(200);
    const entries = [
      report({ contents: [{ key: "今日工作", value: longText }] }),
      report({
        createTime: Date.parse("2026-06-09T10:00:00+08:00"),
        contents: [{ key: "今日工作", value: "second" }],
      }),
    ];
    const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(entries, 50);
    expect(truncated).toBe(true);
    expect(totalChars).toBeLessThanOrEqual(50);
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });
});

describe("fetchEmployeeDailyReportsForEval", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects user not in eval roster", async () => {
    const result = await fetchEmployeeDailyReportsForEval(
      { userId: "unknown", startYmd: "2026-06-01", endYmd: "2026-06-07" },
      { config: MOCK_CONFIG },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_in_eval_roster");
  });

  it("fetches and formats reports via mock client", async () => {
    const mockClient = {
      getAccessToken: vi.fn(),
      fetchUserReports: vi.fn().mockResolvedValue([
        report({ contents: [{ key: "今日工作", value: "写用例" }] }),
      ]),
    };

    const result = await fetchEmployeeDailyReportsForEval(
      { userId: "u_a", startYmd: "2026-06-08", endYmd: "2026-06-08" },
      { config: MOCK_CONFIG, reportClient: mockClient },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reports).toHaveLength(1);
    expect(result.reports[0].templateName).toBe("日报");
    expect(result.reports[0].lines.join("\n")).toContain("写用例");
    expect(mockClient.fetchUserReports).toHaveBeenCalledWith(
      expect.objectContaining({
        userid: "u_a",
        templateName: "日报",
        appKey: "ak1",
      }),
    );
  });
});
