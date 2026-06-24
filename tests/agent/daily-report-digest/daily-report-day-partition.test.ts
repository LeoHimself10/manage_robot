import { describe, expect, it } from "vitest";
import {
  mergePartitionedReports,
  partitionReportEntry,
} from "../../../src/agent/daily-report-digest/daily-report-day-partition";
import type { DailyReportProjectViewConfig } from "../../../src/agent/daily-report-digest/daily-report-project-views";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

function block(idx: string, work: string, project: string, result = "done") {
  return [
    { key: `工作模块${idx}`, value: work },
    { key: `成本归属项目${idx}`, value: project },
    { key: `事项-结果${idx}`, value: result },
  ];
}

const projectViews: Array<DailyReportProjectViewConfig & { orgLabel: string }> = [
  {
    id: "semiconductor-vein",
    label: "半导体",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { keyword: "半导体" },
  },
  {
    id: "cla",
    label: "CLA",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { keyword: "CLA" },
  },
  {
    id: "others",
    label: "其他",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { role: "others" },
  },
];

describe("partitionReportEntry", () => {
  it("routes partial blocks to project and others (严娇娇 pattern)", () => {
    const entry: ReportEntry = {
      creatorUserId: "u1",
      creatorName: "严娇娇",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: [
        ...block("①", "Y1b13 半导体激光", "2514-光纤"),
        ...block("②", "", "2311-冷激光斑块消融导管"),
        ...block("③", "", "2311-冷激光斑块消融导管"),
      ],
    };
    const { byViewId } = partitionReportEntry(entry, projectViews);
    expect(byViewId.get("semiconductor-vein")?.[0]?.contents.some((f) => f.key.includes("①"))).toBe(true);
    const others = byViewId.get("others")?.[0];
    expect(others?.contents.some((f) => f.key.includes("②"))).toBe(true);
    expect(others?.contents.some((f) => f.key.includes("③"))).toBe(true);
  });

  it("routes all blocks to others when no keyword hit", () => {
    const entry: ReportEntry = {
      creatorUserId: "u2",
      creatorName: "邓燕",
      templateName: "研发中心日志（总结及计划）模板",
      createTime: 1,
      contents: [
        ...block("①", "Y1d04 强脉冲光", "2415-Puwa"),
        ...block("②", "Y1a14 PVF", "1801-PVF"),
      ],
    };
    const { byViewId } = partitionReportEntry(entry, projectViews);
    expect(byViewId.has("semiconductor-vein")).toBe(false);
    expect(byViewId.has("cla")).toBe(false);
    expect(byViewId.get("others")?.length).toBe(1);
  });

  it("assigns block to all matching project views (multi-tab)", () => {
    const entry: ReportEntry = {
      creatorUserId: "u3",
      creatorName: "测试",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: block("①", "CLA半导体混合", "项目"),
    };
    const { byViewId } = partitionReportEntry(entry, projectViews);
    expect(byViewId.get("semiconductor-vein")?.length).toBe(1);
    expect(byViewId.get("cla")?.length).toBe(1);
    expect(byViewId.has("others")).toBe(false);
  });

  it("assigns plaque block to both CLA and large-vessel-plaque views", () => {
    const viewsWithPlaque: typeof projectViews = [
      ...projectViews.filter((v) => v.id !== "others"),
      {
        id: "large-vessel-plaque",
        label: "斑块减容",
        viewers: ["m1"],
        orgLabel: "微光",
        filters: { keyword: "斑块减容" },
      },
      projectViews.find((v) => v.id === "others")!,
    ];
    const entry: ReportEntry = {
      creatorUserId: "u4",
      creatorName: "程晓阳",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: block("①", "CLA旋转减容（大血管斑块减容方案）", "2311-冷激光斑块消融导管"),
    };
    const { byViewId } = partitionReportEntry(entry, viewsWithPlaque);
    expect(byViewId.get("cla")?.length).toBe(1);
    expect(byViewId.get("large-vessel-plaque")?.length).toBe(1);
    expect(byViewId.has("others")).toBe(false);
  });

  it("routes block via pair filter when view has no keyword", () => {
    const pairOnlyViews: typeof projectViews = [
      {
        id: "semiconductor-vein",
        label: "半导体",
        viewers: ["m1"],
        orgLabel: "微光",
        filters: {
          workModuleContains: "半导体激光",
          costProjectContains: "静脉腔内闭合系统",
        },
      },
      projectViews.find((v) => v.id === "others")!,
    ];
    const entry: ReportEntry = {
      creatorUserId: "u5",
      creatorName: "配对",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: block("①", "Y1b13 半导体激光", "2514-静脉腔内闭合系统"),
    };
    const { byViewId } = partitionReportEntry(entry, pairOnlyViews);
    expect(byViewId.get("semiconductor-vein")?.length).toBe(1);
    expect(byViewId.has("others")).toBe(false);
  });
});

describe("mergePartitionedReports", () => {
  it("counts each user once in pool despite multi-tab assignment", () => {
    const { byViewId } = partitionReportEntry(
      {
        creatorUserId: "u1",
        creatorName: "张三",
        templateName: "研发管理者日志模板",
        createTime: 1,
        contents: block("①", "CLA半导体混合", "项目"),
      },
      projectViews,
    );
    const merged = mergePartitionedReports("微光", [
      { userid: "u1", name: "张三", byViewId },
    ], ["semiconductor-vein", "cla", "others"]);
    expect(merged.poolUserIds.size).toBe(1);
    expect(merged.byViewId.get("semiconductor-vein")?.submitted).toHaveLength(1);
    expect(merged.byViewId.get("cla")?.submitted).toHaveLength(1);
  });
});
