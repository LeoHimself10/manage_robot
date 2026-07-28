import { describe, expect, it, vi, afterEach } from "vitest";

import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import type { DingTalkContactDirectory } from "../../../src/agent/daily-report-digest/dingtalk-contact-search";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";
import {
  buildEvalReportLinesFromEntries,
  buildEvalWorkHoursSummary,
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

function mockContactDirectory(
  users: Array<{ userid: string; name: string }> = [],
): DingTalkContactDirectory {
  return {
    search: vi.fn(async (_appKey, _appSecret, query, limit = 30) =>
      users
        .filter((user) => user.userid.includes(query) || user.name.includes(query))
        .map((user) => ({ ...user, departments: [] }))
        .slice(0, limit)),
    listAll: vi.fn(async () => users.map((user) => ({ ...user, departments: [] }))),
    invalidate: vi.fn(),
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
    const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(entries);
    expect(truncated).toBe(false);
    expect(reports).toHaveLength(2);
    expect(reports[0].date).toBe("2026-06-08");
    expect(reports[0].lines[0]).toContain("A");
    expect(reports[1].date).toBe("2026-06-09");
    expect(totalChars).toBeGreaterThan(0);
  });

  it("preserves all log text without character truncation", () => {
    const longText = "x".repeat(60_000);
    const entries = [
      report({ contents: [{ key: "今日工作", value: longText }] }),
      report({
        createTime: Date.parse("2026-06-09T10:00:00+08:00"),
        contents: [{ key: "今日工作", value: "second" }],
      }),
    ];
    const { reports, truncated, totalChars } = buildEvalReportLinesFromEntries(entries);
    expect(truncated).toBe(false);
    expect(totalChars).toBeGreaterThan(60_000);
    expect(reports).toHaveLength(2);
    expect(reports[1].lines.join("\n")).toContain("second");
  });
});

describe("buildEvalWorkHoursSummary", () => {
  it("aggregates exact hours by project, module, and task type", () => {
    const entries = [
      report({
        contents: [
          { key: "工作模块①", value: "OCT" },
          { key: "成本归属项目①", value: "OCT 中国注册" },
          { key: "任务类型①", value: "解决问题" },
          { key: "事项-结果①", value: "完成验证" },
          { key: "工时统计①", value: "6.5" },
          { key: "工作模块②", value: "团队管理" },
          { key: "成本归属项目②", value: "公共事务" },
          { key: "任务类型②", value: "管理" },
          { key: "工时统计②", value: "1.5小时" },
        ],
      }),
      report({
        createTime: Date.parse("2026-06-09T10:00:00+08:00"),
        contents: [
          { key: "工作模块①", value: "OCT" },
          { key: "成本归属项目①", value: "OCT 中国注册" },
          { key: "任务类型①", value: "文件输出" },
          { key: "工时统计①", value: "8" },
        ],
      }),
    ];

    const summary = buildEvalWorkHoursSummary(entries);

    expect(summary.totalHours).toBe(16);
    expect(summary.reportCount).toBe(2);
    expect(summary.coveredReportCount).toBe(2);
    expect(summary.loggedItemCount).toBe(3);
    expect(summary.unparsedHourFieldCount).toBe(0);
    expect(summary.availableDimensions.sort()).toEqual([
      "project",
      "taskType",
      "workModule",
    ]);
    expect(summary.byProject[0]).toEqual({
      label: "OCT 中国注册",
      hours: 14.5,
      sharePct: 90.6,
    });
    expect(summary.byWorkModule[0].label).toBe("OCT");
    expect(summary.byTaskType.map((row) => row.label)).toEqual([
      "文件输出",
      "解决问题",
      "管理",
    ]);
  });

  it("reports non-numeric hour fields instead of guessing", () => {
    const summary = buildEvalWorkHoursSummary([
      report({ contents: [{ key: "工时统计①", value: "待补充" }] }),
    ]);

    expect(summary.totalHours).toBe(0);
    expect(summary.loggedItemCount).toBe(0);
    expect(summary.unparsedHourFieldCount).toBe(1);
  });

  it("does not treat a dimension missing from the template as unfilled", () => {
    const summary = buildEvalWorkHoursSummary([
      report({
        contents: [
          { key: "工作模块①", value: "智能体工程-企业" },
          { key: "任务类型①", value: "解决问题" },
          { key: "工时统计①", value: "8" },
        ],
      }),
    ]);

    expect(summary.availableDimensions.sort()).toEqual([
      "taskType",
      "workModule",
    ]);
    expect(summary.byProject).toEqual([]);
    expect(summary.byWorkModule[0].label).toBe("智能体工程-企业");
  });
});

describe("fetchEmployeeDailyReportsForEval", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a user outside configured DingTalk organisations", async () => {
    const result = await fetchEmployeeDailyReportsForEval(
      { userId: "unknown", startYmd: "2026-06-01", endYmd: "2026-06-07" },
      { config: MOCK_CONFIG, contactDirectory: mockContactDirectory() },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_in_configured_org");
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
    expect(result.workHours.reportCount).toBe(1);
    expect(mockClient.fetchUserReports).toHaveBeenCalledWith(
      expect.objectContaining({
        userid: "u_a",
        templateName: "日报",
        appKey: "ak1",
      }),
    );
  });

  it("fetches reports for a current org contact outside the historical roster", async () => {
    const mockClient = {
      getAccessToken: vi.fn(),
      fetchUserReports: vi.fn().mockResolvedValue([
        report({
          creatorUserId: "u_current",
          creatorName: "当前员工",
          contents: [{ key: "今日工作", value: "完成研发验证" }],
        }),
      ]),
    };

    const result = await fetchEmployeeDailyReportsForEval(
      { userId: "u_current", startYmd: "2026-06-08", endYmd: "2026-06-08" },
      {
        config: MOCK_CONFIG,
        contactDirectory: mockContactDirectory([
          { userid: "u_current", name: "当前员工" },
        ]),
        reportClient: mockClient,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reports[0].lines.join("\n")).toContain("完成研发验证");
    expect(mockClient.fetchUserReports).toHaveBeenCalledWith(
      expect.objectContaining({ userid: "u_current", appKey: "ak1" }),
    );
  });
});
