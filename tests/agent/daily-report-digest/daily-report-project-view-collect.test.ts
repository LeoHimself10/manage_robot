import { describe, expect, it, vi } from "vitest";

import { collectProjectViewDigestForRange } from "../../../src/agent/daily-report-digest/daily-report-project-view-collect";
import type { DailyReportOrgConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";
import { parseProjectViewConfig } from "../../../src/agent/daily-report-digest/daily-report-project-views";
import { resolveDayRangeForYmd } from "../../../src/agent/daily-report-digest/daily-report-window";

const FILTER = {
  workModuleContains: "半导体激光",
  costProjectContains: "静脉腔内闭合系统",
};

function moduleFields(
  idx: string,
  work: string,
  project: string,
  result: string,
): ReportEntry["contents"] {
  return [
    { key: `工作模块${idx}`, value: work },
    { key: `成本归属项目${idx}`, value: project },
    { key: `事项-结果${idx}`, value: result },
  ];
}

const matchingEntry: ReportEntry = {
  creatorUserId: "u1",
  creatorName: "张三",
  templateName: "日报",
  createTime: Date.now(),
  contents: moduleFields("②", "半导体激光", "静脉腔内闭合系统", "进展"),
};

describe("collectProjectViewDigestForRange", () => {
  it("scans roster members only, not org.employees", async () => {
    const fetchUserReports = vi.fn(async ({ userid }: { userid: string }) => {
      if (userid === "u1") return [matchingEntry];
      return [];
    });
    const org: DailyReportOrgConfig = {
      label: "微光",
      appKey: "k",
      appSecret: "s",
      employees: [],
      templateName: "日报",
    };
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "半导体激光·静脉项目",
        viewers: ["viewer1"],
        filters: FILTER,
      },
      "微光",
    )!;
    const range = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", {
      cutoffHour: 0,
      cutoffMinute: 0,
    });
    const roster = [{ userid: "u1", name: "张三" }];

    const digest = await collectProjectViewDigestForRange(org, view, range, roster, {
      reportClient: { fetchUserReports } as never,
    });

    expect(fetchUserReports).toHaveBeenCalledTimes(1);
    expect(fetchUserReports).toHaveBeenCalledWith(
      expect.objectContaining({ userid: "u1" }),
    );
    expect(digest.submitted).toHaveLength(1);
    expect(digest.submitted[0]!.userid).toBe("u1");
    expect(digest.submitted[0]!.reports[0]!.contents).toHaveLength(3);
    expect(digest.missing).toEqual([]);
  });

  it("sorts submitted by name zh-CN", async () => {
    const fetchUserReports = vi.fn(async ({ userid }: { userid: string }) => {
      const names: Record<string, string> = { u1: "李四", u2: "张三" };
      return [
        {
          ...matchingEntry,
          creatorUserId: userid,
          creatorName: names[userid] ?? userid,
        },
      ];
    });
    const org: DailyReportOrgConfig = {
      label: "微光",
      appKey: "k",
      appSecret: "s",
      employees: [],
      templateName: "日报",
    };
    const view = parseProjectViewConfig(
      {
        id: "semiconductor-vein",
        label: "x",
        viewers: ["v"],
        filters: FILTER,
      },
      "微光",
    )!;
    const range = resolveDayRangeForYmd("2026-06-08", "Asia/Shanghai", {
      cutoffHour: 0,
      cutoffMinute: 0,
    });
    const roster = [
      { userid: "u1", name: "李四" },
      { userid: "u2", name: "张三" },
    ];

    const digest = await collectProjectViewDigestForRange(org, view, range, roster, {
      reportClient: { fetchUserReports } as never,
    });

    expect(digest.submitted.map((s) => s.name)).toEqual(["李四", "张三"]);
  });
});
