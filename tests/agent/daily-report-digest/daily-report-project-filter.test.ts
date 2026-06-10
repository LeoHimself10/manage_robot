import { describe, expect, it } from "vitest";

import { filterOrgDigestsContents } from "../../../src/agent/daily-report-digest/daily-report-content-filter";
import type { DailyReportOrgConfig } from "../../../src/agent/daily-report-digest/daily-report-config";
import {
  filterReportEntryByProject,
  projectValueMatchesFilter,
} from "../../../src/agent/daily-report-digest/daily-report-project-filter";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

const TARGET = "2310-一次性使用颅内动脉成像导管-IC019/IC018-40/IC018-60";
const MINGSI_FILTERS = ["Y2602-微导管", "Y2601-脑机机器人", "2501-颅内OCT"];

function moduleFields(
  idx: string,
  project: string,
  work: string,
): ReportEntry["contents"] {
  return [
    { key: `工作模块${idx}`, value: "研发" },
    { key: `成本归属项目${idx}`, value: project },
    { key: `任务类型${idx}`, value: "开发" },
    { key: `事项-结果${idx}`, value: work },
    { key: `工时统计${idx}`, value: "8" },
  ];
}

describe("daily-report-project-filter", () => {
  it("matches exact and partial project labels", () => {
    expect(projectValueMatchesFilter(TARGET, [TARGET])).toBe(true);
    expect(projectValueMatchesFilter(`  ${TARGET}  `, [TARGET])).toBe(true);
    expect(projectValueMatchesFilter("2107-CLA-2107", [TARGET])).toBe(false);
  });

  it("matches any keyword in multi-value OR filter (明思)", () => {
    expect(projectValueMatchesFilter("Y2602-微导管-研发", MINGSI_FILTERS)).toBe(true);
    expect(projectValueMatchesFilter("2501-颅内OCT-验证", MINGSI_FILTERS)).toBe(true);
    expect(projectValueMatchesFilter("Y2601-脑机机器人-预研", MINGSI_FILTERS)).toBe(true);
    expect(projectValueMatchesFilter("2107-CLA-2107", MINGSI_FILTERS)).toBe(false);
  });

  it("keeps only modules whose 成本归属项目 hits filter", () => {
    const entry: ReportEntry = {
      creatorUserId: "u1",
      creatorName: "李强",
      templateName: "研发管理者日志模板",
      createTime: 1,
      contents: [
        ...moduleFields("①", "2107-CLA-2107-激光消融导管（CLA导管）", "其他项目工作"),
        ...moduleFields("②", TARGET, "2310 项目进展"),
        { key: "明日计划", value: "继续推进" },
        { key: "----------------------------", value: "" },
      ],
    };

    const filtered = filterReportEntryByProject(entry, [TARGET]);
    expect(filtered.contents.map((f) => f.key)).toEqual([
      "工作模块②",
      "成本归属项目②",
      "任务类型②",
      "事项-结果②",
      "工时统计②",
    ]);
    expect(filtered.contents.find((f) => f.key.includes("事项-结果"))?.value).toBe("2310 项目进展");
  });

  it("returns empty contents when no module matches", () => {
    const entry: ReportEntry = {
      creatorUserId: "u1",
      creatorName: "贾三祥",
      templateName: "模板",
      createTime: 1,
      contents: moduleFields("①", "2503-电子皮肤镜", "别的项目"),
    };
    expect(filterReportEntryByProject(entry, [TARGET]).contents).toEqual([]);
  });
});

describe("filterOrgDigestsContents with projectFilter", () => {
  const orgConfigs: DailyReportOrgConfig[] = [
    {
      label: "微光",
      appKey: "k",
      appSecret: "s",
      employees: [],
      projectFilter: [TARGET],
    },
  ];

  it("applies projectFilter only to configured org label", () => {
    const orgDigests = [
      {
        label: "微光",
        submitted: [
          {
            userid: "u1",
            name: "李强",
            reports: [
              {
                creatorUserId: "u1",
                creatorName: "李强",
                templateName: "t",
                createTime: 1,
                contents: [
                  ...moduleFields("①", "2107-CLA", "A"),
                  ...moduleFields("②", TARGET, "B"),
                ],
              },
            ],
          },
        ],
        missing: [],
        errors: [],
      },
      {
        label: "明思",
        submitted: [
          {
            userid: "u2",
            name: "张三",
            reports: [
              {
                creatorUserId: "u2",
                creatorName: "张三",
                templateName: "t",
                createTime: 1,
                contents: [{ key: "今日工作", value: "全部保留" }],
              },
            ],
          },
        ],
        missing: [],
        errors: [],
      },
    ];

    const filtered = filterOrgDigestsContents(orgDigests, orgConfigs);
    const wg = filtered[0]!.submitted[0]!.reports[0]!.contents;
    expect(wg).toHaveLength(5);
    expect(wg.find((f) => f.key.includes("事项-结果"))?.value).toBe("B");

    const ms = filtered[1]!.submitted[0]!.reports[0]!.contents;
    expect(ms).toHaveLength(1);
    expect(ms[0]!.value).toBe("全部保留");
  });
});
