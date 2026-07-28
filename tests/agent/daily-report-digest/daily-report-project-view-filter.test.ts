import { describe, expect, it } from "vitest";
import {
  filterReportEntryByCostProject,
  filterReportEntryForView,
  moduleBlockMatchesCostProjectFilter,
  moduleBlockMatchesKeywordFilter,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-filter";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

function block(idx: string, work: string, project: string) {
  return [
    { key: `${idx} 工作模块`, value: work },
    { key: `${idx} 成本归属项目`, value: project },
    { key: `${idx} 事项-结果`, value: "完成调试" },
  ];
}

const entry: ReportEntry = {
  creatorUserId: "u1",
  creatorName: "张三",
  templateName: "日报",
  createTime: 1,
  contents: [
    ...block("①", "Y1b13 半导体激光", "其他项目"),
    ...block("②", "行政", "静脉腔内闭合系统"),
    ...block("③", "无关", "无关"),
  ],
};

describe("moduleBlockMatchesKeywordFilter", () => {
  it("matches work module only", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "①", "半导体")).toBe(true);
  });
  it("matches cost project only", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "②", "静脉")).toBe(true);
  });
  it("misses when neither field contains keyword", () => {
    expect(moduleBlockMatchesKeywordFilter(entry.contents, "③", "半导体")).toBe(false);
  });
});

describe("filterReportEntryForView keyword mode", () => {
  it("keeps blocks matching keyword in work OR project", () => {
    const filtered = filterReportEntryForView(entry, { keyword: "半导体" });
    const keys = filtered.contents.map((f) => f.key).join("|");
    expect(keys).toContain("①");
    expect(keys).not.toContain("③");
  });
});

describe("complete vein-closure project name", () => {
  it("excludes the similarly named 2511 cost project", () => {
    const mixed: ReportEntry = {
      ...entry,
      contents: [
        ...block("①", "Y1b13 半导体激光", "2511—一次性使用静脉腔内射频闭合导管（RF-3-60、RF-7-60）中国"),
        ...block("②", "Y1b13 半导体激光", "2517—静脉腔内闭合系统（RFL-I）中国"),
      ],
    };

    const filtered = filterReportEntryForView(mixed, {
      costProjectContains: "静脉腔内闭合系统",
    });
    expect(filtered.contents.map((field) => field.key)).toEqual([
      "② 工作模块",
      "② 成本归属项目",
      "② 事项-结果",
    ]);
  });
});

describe("filterReportEntryForView cost-project-only mode", () => {
  it("keeps only the module whose cost project contains the project name", () => {
    expect(moduleBlockMatchesCostProjectFilter(entry.contents, "②", "静脉腔")).toBe(true);
    const filtered = filterReportEntryByCostProject(entry, "静脉腔");
    expect(filtered.contents.map((field) => field.key)).toEqual([
      "② 工作模块",
      "② 成本归属项目",
      "② 事项-结果",
    ]);
  });

  it("does not use the work-module text in cost-project-only mode", () => {
    const filtered = filterReportEntryForView(entry, { costProjectContains: "静脉腔" });
    const keys = filtered.contents.map((field) => field.key).join("|");
    expect(keys).toContain("②");
    expect(keys).not.toContain("①");
  });
});
