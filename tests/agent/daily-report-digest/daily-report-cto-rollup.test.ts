import { describe, expect, it } from "vitest";

import {
  buildCtoRollupProjectLine,
  renderCtoRollupMorningMarkdown,
  sanitizeCtoRollupOverviewLine,
} from "../../../src/agent/daily-report-digest/daily-report-cto-rollup-morning-render";
import {
  normalizePlainTextOverview,
  stripMarkdownCodeFence,
} from "../../../src/agent/daily-report-digest/daily-report-llm-parse";
import {
  fallbackCtoRollupOverviewSummary,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-morning-llm";
import {
  groupProjectViewDigestPlansByUser,
} from "../../../src/agent/daily-report-digest/daily-report-project-views";
import { parseDailyReportDigestConfig } from "../../../src/agent/daily-report-digest/daily-report-config";

const FILTER = {
  workModuleContains: "CLA",
  costProjectContains: "355",
};

describe("cto rollup morning render", () => {
  it("renderCtoRollupMorningMarkdown lists all projects", () => {
    const rendered = renderCtoRollupMorningMarkdown({
      dateLabel: "2026-06-20（周五）（2026-06-20）",
      dateYmd: "2026-06-20",
      projectLines: [
        {
          viewId: "cla",
          viewLabel: "CLA",
          rosterCount: 25,
          submittedCount: 14,
          line: "355 试产推进，型检放行完成",
        },
        {
          viewId: "oct",
          viewLabel: "OCT",
          rosterCount: 29,
          submittedCount: 0,
          line: "暂无相关记录",
        },
      ],
    });
    expect(rendered.title).toBe("微光研发 · 昨日项目日报");
    expect(rendered.text).toContain("CLA");
    expect(rendered.text).toContain("355 试产推进");
    expect(rendered.text).toContain("暂无相关记录");
  });

  it("buildCtoRollupProjectLine sanitizes overview", () => {
    const line = buildCtoRollupProjectLine({
      viewId: "v1",
      viewLabel: "CLA",
      rosterCount: 10,
      submittedCount: 3,
      overviewLine: "6月20日，统计名单内 10 人，3 人提交。355 试产骨架完成",
    });
    expect(line.line).toContain("355 试产骨架完成");
    expect(line.line).not.toMatch(/统计名单/);
  });
});

describe("normalizePlainTextOverview", () => {
  it("strips markdown fence", () => {
    expect(normalizePlainTextOverview("```\n推进样机调试\n```")).toBe("推进样机调试");
  });

  it("extracts overview from accidental JSON", () => {
    expect(
      normalizePlainTextOverview('{"overview":"完成 DHF 更新"}'),
    ).toBe("完成 DHF 更新");
  });
});

describe("fallbackCtoRollupOverviewSummary field priority", () => {
  it("prefers 事项/结果 over 工作模块", () => {
    const summary = fallbackCtoRollupOverviewSummary("半导体激光", 7, {
      label: "微光",
      submitted: [
        {
          userid: "u1",
          name: "张三",
          reports: [
            {
              templateName: "日报",
              createTime: 1,
              creatorUserId: "u1",
              creatorName: "张三",
              contents: [
                { key: "工作模块", value: "Y1b13 半导体激光", type: "text" },
                { key: "今日完成事项", value: "完成耦合调试", type: "text" },
              ],
            },
          ],
        },
      ],
      missing: [],
      onLeave: [],
      errors: [],
    });
    expect(summary.overview).toContain("完成耦合调试");
    expect(summary.overview).not.toContain("Y1b13");
  });
});

describe("groupProjectViewDigestPlansByUser", () => {
  it("groups multiple views per recipient", () => {
    process.env.DAILY_REPORT_PROJECT_VIEWS_ENABLED = "1";
    const config = parseDailyReportDigestConfig({
      timezone: "Asia/Shanghai",
      webhook: { accessToken: "t" },
      orgs: [
        {
          label: "微光",
          appKey: "k",
          appSecret: "s",
          employees: [],
          projectViews: [
            {
              id: "v1",
              label: "A",
              viewers: ["u1", "u2"],
              filters: FILTER,
              digest: { enabled: true },
            },
            {
              id: "v2",
              label: "B",
              viewers: ["u1"],
              filters: FILTER,
              digest: { enabled: true },
            },
          ],
        },
      ],
    }).config;

    const grouped = groupProjectViewDigestPlansByUser(config);
    expect(grouped.get("u1")).toHaveLength(2);
    expect(grouped.get("u2")).toHaveLength(1);
  });
});

describe("sanitizeCtoRollupOverviewLine", () => {
  it("removes date prefix", () => {
    expect(sanitizeCtoRollupOverviewLine("6月20日，推进试产")).toBe("推进试产");
  });
});

describe("stripMarkdownCodeFence", () => {
  it("handles json fence", () => {
    expect(stripMarkdownCodeFence("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
});
