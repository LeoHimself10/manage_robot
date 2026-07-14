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

  it("renders a candidate-detail entry point with facts and linked feedback", () => {
    const html = renderQualityTrackingPage({ role: "manager", userId: "after", canReport: true });

    expect(html).toContain("查看详情并编辑通报");
    expect(html).toContain('id="qualityCandidateDetailDialog"');
    expect(html).toContain('id="qualityCandidateFacts"');
    expect(html).toContain('id="qualityCandidateSources"');
  });
});
