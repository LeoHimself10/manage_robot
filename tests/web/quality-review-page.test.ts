import { describe, expect, it } from "vitest";
import { renderQualityReviewPage } from "../../src/web/quality-review-page";

describe("renderQualityReviewPage", () => {
  it("renders the C1 review workspace with queue, detail, filters and source controls", () => {
    const html = renderQualityReviewPage({
      role: "manager",
      userId: "after-1",
      userLabel: "售后主管",
    });

    expect(html).toContain("反馈研判工作台");
    expect(html).toContain('id="qualityReviewQueue"');
    expect(html).toContain('id="qualityReviewDetail"');
    expect(html).toContain('data-review-scope="UNREVIEWED"');
    expect(html).toContain('data-review-scope="NEEDS_INFO"');
    expect(html).toContain('data-review-scope="COMPLETED"');
    expect(html).toContain('name="risk"');
    expect(html).toContain('name="deviceModel"');
    expect(html).toContain('name="category"');
    expect(html).toContain("普通反馈");
    expect(html).toContain("待补资料");
    expect(html).toContain("通报质量异常");
    expect(html).toContain("立即同步");
    expect(html).toContain("打开钉钉原表");
    expect(html).toContain("重新回写");
  });
});
