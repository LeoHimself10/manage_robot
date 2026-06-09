import { describe, expect, it } from "vitest";
import {
  fallbackMorningSummary,
  slimOrgDigestsForLlm,
} from "../../../src/agent/daily-report-digest/daily-report-morning-llm";
import {
  renderMorningReportMarkdown,
  reportEntriesToSheetRows,
} from "../../../src/agent/daily-report-digest/daily-report-morning-build";
import type { OrgDigest } from "../../../src/agent/daily-report-digest/daily-report-build";
import {
  filterReportContentsWithBody,
  filterOrgDigestsContents,
} from "../../../src/agent/daily-report-digest/daily-report-content-filter";

const SAMPLE_ORGS: OrgDigest[] = [
  {
    label: "明思",
    submitted: [
      {
        userid: "u1",
        name: "李嘉男",
        reports: [
          {
            creatorUserId: "u1",
            creatorName: "李嘉男",
            templateName: "研发日报",
            createTime: 1,
            contents: [
              { key: "今日工作", value: "完成接口联调" },
              { key: "明日计划", value: "" },
            ],
          },
        ],
      },
    ],
    missing: [{ userid: "u2", name: "崔枭" }],
    errors: [],
  },
];

describe("daily-report-content-filter", () => {
  it("drops modules with empty value", () => {
    const filtered = filterReportContentsWithBody([
      { key: "今日工作", value: "有内容" },
      { key: "明日计划", value: "  " },
      { key: "备注", value: "无" },
    ]);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((f) => f.key)).toEqual(["今日工作", "备注"]);
  });

  it("filters org digests before consumers", () => {
    const filtered = filterOrgDigestsContents(SAMPLE_ORGS);
    expect(filtered[0]!.submitted[0]!.reports[0]!.contents).toHaveLength(1);
  });
});

describe("daily-report-morning-llm", () => {
  it("slims org digests without org labels", () => {
    const slim = slimOrgDigestsForLlm(SAMPLE_ORGS) as {
      people: unknown[];
      missing: string[];
    };
    expect(slim.people.length).toBe(1);
    expect(slim.missing).toContain("崔枭");
    expect(JSON.stringify(slim)).not.toContain("明思");
  });

  it("fallback summary uses v2 shape", () => {
    const fb = fallbackMorningSummary(SAMPLE_ORGS, "2026-06-08");
    expect(fb.overview).toContain("1 人已交");
    expect(fb.closing).toContain("崔枭");
    expect(fb.personBriefs[0]?.name).toBe("李嘉男");
  });
});

describe("daily-report-morning-build", () => {
  it("converts report entries to sheet rows without empty modules", () => {
    const rows = reportEntriesToSheetRows(SAMPLE_ORGS[0]!.submitted[0]!.reports);
    expect(rows[0]).toEqual(["字段", "内容"]);
    expect(rows[1]).toEqual(["今日工作", "完成接口联调"]);
    expect(rows.some((r) => r[0] === "明日计划")).toBe(false);
  });

  it("renders morning markdown with v2 summary and daily workbook link", () => {
    const out = renderMorningReportMarkdown({
      title: "每日早报",
      dateLabel: "2026-06-08",
      summary: {
        overview: "整体推进顺利",
        personBriefs: [{ name: "李嘉男", brief: "完成联调" }],
        closing: "崔枭未交",
      },
      orgDigests: SAMPLE_ORGS,
      dailyWorkbook: {
        url: "https://example.com/doc",
        name: "2026-06-08 日报汇总",
        sheetCount: 1,
        sheetErrors: [],
      },
    });
    expect(out.text).toContain("昨日综述");
    expect(out.text).toContain("整体进展");
    expect(out.text).toContain("整体推进顺利");
    expect(out.text).toContain("个人简述");
    expect(out.text).toContain("李嘉男：完成联调");
    expect(out.text).toContain("总结");
    expect(out.text).toContain("昨日日报总表");
    expect(out.text).toContain("https://example.com/doc");
    expect(out.submittedCount).toBe(1);
    expect(out.missingCount).toBe(1);
  });
});
