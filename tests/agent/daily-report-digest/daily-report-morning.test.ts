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
            contents: [{ key: "今日工作", value: "完成接口联调" }],
          },
        ],
      },
    ],
    missing: [{ userid: "u2", name: "崔枭" }],
    errors: [],
  },
];

describe("daily-report-morning-llm", () => {
  it("parses LLM JSON output", () => {
    const parsed = JSON.parse(
      '{"headline":"昨日整体推进顺利","highlights":["李嘉男完成联调"],"attention":"崔枭未交"}',
    );
    expect(parsed.headline).toContain("推进");
  });

  it("slims org digests for token budget", () => {
    const slim = slimOrgDigestsForLlm(SAMPLE_ORGS);
    expect((slim.orgs as unknown[]).length).toBe(1);
  });

  it("fallback summary mentions counts", () => {
    const fb = fallbackMorningSummary(SAMPLE_ORGS, "2026-06-08");
    expect(fb.headline).toContain("1 人已交");
    expect(fb.attention).toContain("崔枭");
  });
});

describe("daily-report-morning-build", () => {
  it("converts report entries to sheet rows", () => {
    const rows = reportEntriesToSheetRows(SAMPLE_ORGS[0]!.submitted[0]!.reports);
    expect(rows[0]).toEqual(["字段", "内容"]);
    expect(rows[1]![0]).toBe("今日工作");
  });

  it("renders morning markdown with summary and links", () => {
    const out = renderMorningReportMarkdown({
      title: "每日早报",
      dateLabel: "2026-06-08",
      summary: { headline: "测试综述", highlights: ["要点一"] },
      orgDigests: SAMPLE_ORGS,
      workbookLinks: [{ orgLabel: "明思", name: "李嘉男", url: "https://example.com/doc" }],
    });
    expect(out.text).toContain("昨日综述");
    expect(out.text).toContain("测试综述");
    expect(out.text).toContain("个人日报表格");
    expect(out.text).toContain("https://example.com/doc");
    expect(out.submittedCount).toBe(1);
    expect(out.missingCount).toBe(1);
  });
});
