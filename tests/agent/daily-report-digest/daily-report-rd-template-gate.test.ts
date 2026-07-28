import { describe, expect, it } from "vitest";
import {
  isRdDailyTemplate,
  reportMatchesAnyProjectKeyword,
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

describe("cost-project-only unified partition eligibility", () => {
  it("accepts a non-R&D report when only the cost project matches", () => {
    const costOnlyViews = [{
      id: "vein-closure-system",
      label: "静脉腔闭合系统",
      viewers: ["m1"],
      orgLabel: "微光",
      filters: { costProjectContains: "静脉腔内闭合系统" },
    }];
    const medical: ReportEntry = {
      creatorUserId: "u2",
      creatorName: "李四",
      templateName: "医学事务部日志",
      createTime: 1,
      contents: [
        { key: "工作模块①", value: "Y1b13 半导体激光" },
        { key: "成本归属项目①", value: "2517—静脉腔内闭合系统（RFL-I）中国" },
        { key: "事项-结果①", value: "完成验证" },
      ],
    };

    expect(reportMatchesAnyProjectKeyword(medical, costOnlyViews)).toBe(true);
    expect(reportEligibleForUnifiedPartition(medical, costOnlyViews)).toBe(true);
  });
});

describe("reportEligibleForUnifiedPartition", () => {
  it("accepts non-RD template when module matches project keyword", () => {
    const custom = entry("研发日报-明思", "Y1b13 半导体激光");
    expect(reportEligibleForUnifiedPartition(custom, projectViews)).toBe(true);
  });

  it("accepts medical affairs when module matches project keyword", () => {
    const med = entry("医学事务部日志", "半导体项目");
    expect(reportEligibleForUnifiedPartition(med, projectViews)).toBe(true);
  });

  it("rejects medical affairs without keyword match", () => {
    const med = entry("医学事务部日志", "行政事务");
    expect(reportEligibleForUnifiedPartition(med, projectViews)).toBe(false);
  });

  it("rejects unrelated template without keyword match", () => {
    const other = entry("行政日报", "行政事务");
    expect(reportEligibleForUnifiedPartition(other, projectViews)).toBe(false);
  });
});
