import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { collectUnifiedDayPartition } from "../../../src/agent/daily-report-digest/daily-report-unified-day-collect";
import type { DailyReportProjectViewConfig } from "../../../src/agent/daily-report-digest/daily-report-project-views";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

function block(idx: string, work: string, project: string) {
  return [
    { key: `工作模块${idx}`, value: work },
    { key: `成本归属项目${idx}`, value: project },
    { key: `事项-结果${idx}`, value: "进展" },
  ];
}

const views: Array<DailyReportProjectViewConfig & { orgLabel: string }> = [
  {
    id: "semiconductor-vein",
    label: "半导体",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { keyword: "半导体" },
  },
  {
    id: "others",
    label: "其他",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { role: "others" },
  },
];

describe("collectUnifiedDayPartition", () => {
  const org = {
    label: "微光",
    appKey: "k",
    appSecret: "s",
    templateName: "",
    employees: [],
  };

  it("partitions RD templates and excludes medical affairs", async () => {
    const rdEntry: ReportEntry = {
      creatorUserId: "u1",
      creatorName: "张三",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: block("①", "Y1b13 半导体激光", "2514"),
    };
    const medEntry: ReportEntry = {
      creatorUserId: "u2",
      creatorName: "韦静",
      templateName: "医学事务部日志",
      createTime: 1,
      contents: block("①", "医学", "事务"),
    };

    const reportClient = {
      fetchUserReports: vi.fn(async ({ userid }: { userid: string }) => {
        if (userid === "u1") return [rdEntry];
        if (userid === "u2") return [medEntry];
        return [];
      }),
    };

    const result = await collectUnifiedDayPartition({
      org,
      range: {
        labelYmd: "2026-06-22",
        labelDisplay: "6月22日",
        startTime: 0,
        endTime: 1,
      },
      projectViews: views,
      reportClient: reportClient as never,
      scanContacts: [
        { userid: "u1", name: "张三" },
        { userid: "u2", name: "韦静" },
      ],
    });

    expect(result.poolCount).toBe(1);
    expect(result.byViewId.get("semiconductor-vein")?.submitted).toHaveLength(1);
    expect(result.byViewId.get("others")?.submitted).toHaveLength(0);
  });

  it("includes non-RD template when keyword matches", async () => {
    const customEntry: ReportEntry = {
      creatorUserId: "u3",
      creatorName: "李四",
      templateName: "研发日报-明思",
      createTime: 1,
      contents: block("①", "Y1b13 半导体激光", "2514"),
    };

    const reportClient = {
      fetchUserReports: vi.fn(async () => [customEntry]),
    };

    const result = await collectUnifiedDayPartition({
      org,
      range: {
        labelYmd: "2026-06-22",
        labelDisplay: "6月22日",
        startTime: 0,
        endTime: 1,
      },
      projectViews: views,
      reportClient: reportClient as never,
      scanContacts: [{ userid: "u3", name: "李四" }],
    });

    expect(result.poolCount).toBe(1);
    expect(result.byViewId.get("semiconductor-vein")?.submitted).toHaveLength(1);
  });
});
