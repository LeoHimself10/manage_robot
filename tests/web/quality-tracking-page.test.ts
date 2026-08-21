import { describe, expect, it } from "vitest";
import { renderQualityTrackingPage } from "../../src/web/quality-tracking-page";

describe("renderQualityTrackingPage", () => {
  it("renders an aftersales default mode switch for dual-role users", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "yang",
      canReport: true,
      isSpecialist: true,
    });

    expect(html).toContain('data-quality-mode="aftersales"');
    expect(html).toContain('data-quality-mode-switch="aftersales"');
    expect(html).toContain('data-quality-mode-switch="specialist"');
    expect(html).toContain("质量专员");
  });

  it("renders only the specialist event view for a specialist", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "specialist",
      canReport: false,
      isSpecialist: true,
    });

    const mainHtml = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(mainHtml).toContain('data-quality-mode="specialist"');
    expect(mainHtml).toContain("待分配");
    expect(mainHtml).not.toContain("异常候选");
  });

  it("keeps the aftersales landing page focused on reporting and opens the review workbench in a new window", () => {
    const html = renderQualityTrackingPage({ role: "manager", userId: "after", canReport: true });

    const mainHtml = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    expect(mainHtml).toContain('href="/workbench/quality/review"');
    expect(mainHtml).toContain('target="_blank"');
    expect(mainHtml).toContain("新建质量异常");
    expect(mainHtml).toContain("我通报的事件");
    expect(mainHtml).not.toContain("异常候选");
    expect(mainHtml).not.toContain("全部反馈");
    expect(mainHtml).not.toContain("已通报");
  });
});
