import { describe, expect, it } from "vitest";
import {
  isRdDailyTemplate,
  reportEligibleForUnifiedPartition,
} from "../../../src/agent/daily-report-digest/daily-report-rd-template-gate";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

const projectViews = [
  {
    id: "semiconductor-vein",
    label: "半导体",
    viewers: ["m1"],
    orgLabel: "微光",
    filters: { keyword: "半导体" },
  },
];

function entry(templateName: string, work: string): ReportEntry {
  return {
    creatorUserId: "u1",
    creatorName: "张三",
    templateName,
    createTime: 1,
    contents: [
      { key: "工作模块①", value: work },
      { key: "成本归属项目①", value: "2514" },
      { key: "事项-结果①", value: "进展" },
    ],
  };
}

describe("isRdDailyTemplate", () => {
  it("accepts three R&D template name variants", () => {
    expect(isRdDailyTemplate("研发中心日志（总结及计划）模板")).toBe(true);
    expect(isRdDailyTemplate("研发管理者日志模板")).toBe(true);
    expect(isRdDailyTemplate("研发试用期日志模版")).toBe(true);
    expect(isRdDailyTemplate("研发试用期日志模板")).toBe(true);
  });

  it("rejects medical affairs and empty", () => {
    expect(isRdDailyTemplate("医学事务部日志")).toBe(false);
    expect(isRdDailyTemplate("")).toBe(false);
  });
});

describe("reportEligibleForUnifiedPartition", () => {
  it("accepts non-RD template when module matches project keyword", () => {
    const custom = entry("研发日报-明思", "Y1b13 半导体激光");
    expect(reportEligibleForUnifiedPartition(custom, projectViews)).toBe(true);
  });

  it("rejects medical affairs even with keyword match", () => {
    const med = entry("医学事务部日志", "半导体项目");
    expect(reportEligibleForUnifiedPartition(med, projectViews)).toBe(false);
  });

  it("rejects unrelated template without keyword match", () => {
    const other = entry("行政日报", "行政事务");
    expect(reportEligibleForUnifiedPartition(other, projectViews)).toBe(false);
  });
});
