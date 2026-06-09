import { describe, expect, it } from "vitest";
import {
  formatAttachmentSummary,
  formatFieldDisplayValue,
  parseAttachmentsFromValue,
  parseReportImages,
} from "../../../src/agent/daily-report-digest/daily-report-attachments";
import { filterReportContentsWithBody } from "../../../src/agent/daily-report-digest/daily-report-content-filter";
import { reportEntriesToSheetRows } from "../../../src/agent/daily-report-digest/daily-report-morning-build";
import type { ReportEntry } from "../../../src/agent/daily-report-digest/dingtalk-report-client";

describe("daily-report-attachments", () => {
  it("parses empty attachment JSON as none", () => {
    expect(parseAttachmentsFromValue("[]")).toEqual([]);
    expect(parseAttachmentsFromValue("  ")).toEqual([]);
  });

  it("parses attachment metadata from type=9 value", () => {
    const parsed = parseAttachmentsFromValue(
      JSON.stringify([
        { fileName: "方案.pdf", fileId: "f1", spaceId: "s1" },
        { name: "截图.png", url: "https://example.com/a.png" },
      ]),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.name).toBe("方案.pdf");
    expect(parsed[1]?.url).toContain("example.com");
  });

  it("parses top-level images array", () => {
    const imgs = parseReportImages(["https://cdn.example.com/a.jpg"]);
    expect(imgs[0]?.name).toBe("a.jpg");
    expect(imgs[0]?.url).toContain("cdn.example.com");
  });

  it("formats attachment summary for display", () => {
    expect(formatAttachmentSummary([{ name: "a.pdf" }, { name: "b.png" }])).toBe(
      "附件 2 个：a.pdf、b.png",
    );
  });

  it("filters empty attachment modules but keeps non-empty", () => {
    const kept = filterReportContentsWithBody([
      { key: "附件", value: "[]", type: "9", attachments: [] },
      {
        key: "附件",
        value: "[]",
        type: "9",
        attachments: [{ name: "合同.pdf" }],
      },
    ]);
    expect(kept).toHaveLength(1);
    expect(formatFieldDisplayValue(kept[0]!)).toContain("合同.pdf");
  });

  it("renders attachment row in sheet output", () => {
    const reports: ReportEntry[] = [
      {
        creatorUserId: "u1",
        creatorName: "测试",
        templateName: "日报",
        createTime: 1,
        contents: [
          {
            key: "附件",
            value: "[]",
            type: "9",
            attachments: [{ name: "周报.docx" }],
          },
        ],
      },
    ];
    const rows = reportEntriesToSheetRows(reports);
    expect(rows.some((r) => r[0] === "附件" && r[1]?.includes("周报.docx"))).toBe(true);
  });
});
