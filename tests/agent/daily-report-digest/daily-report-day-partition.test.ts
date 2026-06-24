import { describe, expect, it } from "vitest";
import {
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

  it("uses config order when block matches multiple keywords", () => {
    const entry: ReportEntry = {
      creatorUserId: "u3",
      creatorName: "测试",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: block("①", "CLA半导体混合", "项目"),
    };
    const { byViewId } = partitionReportEntry(entry, projectViews);
    expect(byViewId.get("semiconductor-vein")?.length).toBe(1);
    expect(byViewId.has("cla")).toBe(false);
    expect(byViewId.has("others")).toBe(false);
  });
});
