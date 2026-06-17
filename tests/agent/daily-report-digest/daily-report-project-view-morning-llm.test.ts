import { describe, expect, it } from "vitest";
import type { OrgDigest } from "../../../src/agent/daily-report-digest/daily-report-build";
import {
  fallbackProjectViewMorningSummary,
  slimProjectViewDigestForLlm,
} from "../../../src/agent/daily-report-digest/daily-report-project-view-morning-llm";
import { renderProjectViewMorningMarkdown } from "../../../src/agent/daily-report-digest/daily-report-project-view-morning-render";

const VIEW_LABEL = "半导体激光·静脉项目";

const SAMPLE_DIGEST: OrgDigest = {
  label: "微光",
  submitted: [
    {
      userid: "u1",
      name: "周毓凡",
      reports: [
        {
          creatorUserId: "u1",
          creatorName: "周毓凡",
          templateName: "日报",
          createTime: 1,
          contents: [{ key: "事项-结果②", value: "完成联调" }],
        },
      ],
    },
  ],
  missing: [],
  onLeave: [],
  errors: [],
};

describe("daily-report-project-view-morning-llm", () => {
  it("slims digest without internal terms", () => {
    const slim = slimProjectViewDigestForLlm(VIEW_LABEL, 7, SAMPLE_DIGEST);
    expect(slim.submittedCount).toBe(1);
    expect(slim.rosterCount).toBe(7);
    expect(slim.people[0]?.name).toBe("周毓凡");
    expect(JSON.stringify(slim)).not.toContain("命中");
  });

  it("fallback for zero submitted uses natural empty copy", () => {
    const empty: OrgDigest = { ...SAMPLE_DIGEST, submitted: [] };
    const fb = fallbackProjectViewMorningSummary(VIEW_LABEL, "2026-06-08", 7, empty);
    expect(fb.overview).toContain("暂无");
    expect(fb.overview).toContain("7 人");
    expect(fb.personBriefs).toHaveLength(0);
    expect(JSON.stringify(fb)).not.toMatch(/命中|filter|roster/i);
  });

  it("fallback for submitted includes counts", () => {
    const fb = fallbackProjectViewMorningSummary(VIEW_LABEL, "2026-06-08", 7, SAMPLE_DIGEST);
    expect(fb.overview).toContain("1 人");
    expect(fb.personBriefs[0]?.name).toBe("周毓凡");
  });
});

describe("daily-report-project-view-morning-render", () => {
  it("renders markdown without 命中 and no missing section", () => {
    const summary = fallbackProjectViewMorningSummary(
      VIEW_LABEL,
      "2026-06-08（2026-06-08）",
      7,
      SAMPLE_DIGEST,
    );
    const rendered = renderProjectViewMorningMarkdown({
      viewLabel: VIEW_LABEL,
      dateLabel: "2026-06-08（2026-06-08）",
      dateYmd: "2026-06-08",
      summary,
      submittedCount: 1,
      rosterCount: 7,
      workbenchUrl: "https://example.com/daily-reports?view=custom:semiconductor-vein",
    });
    expect(rendered.text).toContain("项目组早报");
    expect(rendered.text).toContain("统计名单内 7 人");
    expect(rendered.text).not.toMatch(/命中|未交|请假/i);
    expect(rendered.text).toContain("semiconductor-vein");
  });
});
