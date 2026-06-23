import { describe, expect, it } from "vitest";
import {
  filterReportEntryForView,
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
