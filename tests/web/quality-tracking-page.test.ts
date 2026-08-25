import { describe, expect, it } from "vitest";
import { renderQualityTrackingPage } from "../../src/web/quality-tracking-page";

describe("renderQualityTrackingPage", () => {
  it("migrates the prototype quality processing center into the real workbench shell", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
      isSpecialist: true,
    });

    expect(html).toContain("质量处理中心");
    expect(html).toContain('id="qualityMetrics"');
    expect(html).toContain("待研判反馈／质量事件列表");
    expect(html).toContain('data-quality-list="feedback"');
    expect(html).toContain('data-quality-list="event"');
    expect(html).toContain('id="qualityWorkspace"');
    expect(html).toContain("任务分配结果");
    expect(html).toContain("责任链与证据");
    expect(html).toContain("终验与审计");
    expect(html).not.toContain("质量异常工作台");
    expect(html).not.toContain("离线交互原型");
    expect(html).not.toContain("模拟角色");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain('id="qualityAssessmentDialog"');
  });

  it("keeps source feedback hidden for a specialist without aftersales access", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "specialist",
      canReport: false,
      isSpecialist: true,
    });

    const mainHtml = html.slice(html.indexOf('<main class="qpc-page"'), html.indexOf("</main>"));
    expect(mainHtml).toContain('data-quality-list="event"');
    expect(mainHtml).not.toContain('data-quality-list="feedback"');
    expect(html).toContain("if (type === 'feedback' && !canReport) return");
  });

  it("uses one inline five-stage workspace and restores review deep links", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
      reviewSourceKey: "feedback:REAL-001",
    });

    expect(html).toContain('data-quality-stage="review"');
    expect(html).toContain('data-quality-stage="analysis"');
    expect(html).toContain('data-quality-stage="assignment"');
    expect(html).toContain('data-quality-stage="chain"');
    expect(html).toContain('data-quality-stage="final"');
    expect(html).toContain('var initialSourceKey = "feedback:REAL-001"');
    expect(html).toContain("window.addEventListener('popstate', restoreFromUrl)");
    expect(html).toContain("fetch('/api/workbench/logout'");
    expect(html).toContain("/workbench/quality/review?sourceKey=");
  });

  it("renders the formal 9/27 taxonomy plus explicit custom category fallbacks", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
    });
    const taxonomyJson = html.match(
      /<template id="qualityTaxonomyData">([\s\S]*?)<\/template>/,
    )?.[1];
    expect(taxonomyJson).toBeTruthy();
    const taxonomy = JSON.parse(taxonomyJson!) as {
      categories: Array<{ secondaryCategories: unknown[] }>;
    };

    expect(taxonomy.categories).toHaveLength(9);
    expect(taxonomy.categories.flatMap((item) => item.secondaryCategories)).toHaveLength(27);
    expect(html).toContain('id="qualityPrimaryCategory"');
    expect(html).toContain('id="qualitySecondaryCategory"');
    expect(html).toContain("其他（手动输入）");
    expect(html).toContain('name="customPrimaryCategoryName"');
    expect(html).toContain('name="customSecondaryCategoryName"');
    expect(html).toContain("CUSTOM_SECONDARY");
    expect(html).toContain("CUSTOM_FULL");
    expect(html).toContain("自定义二级分类必填");
    expect(html).toContain("自定义分类必填");
  });

  it("keeps AI adoption separate from save and leaves later analysis disabled", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
    });

    expect(html).toContain("AI建议，需人工确认");
    expect(html).toContain("AI研判失败，请人工处理");
    expect(html).toContain("applyAiSuggestion");
    expect(html).toContain("setAdoptionMode('MODIFIED')");
    expect(html).toContain("form.addEventListener('submit'");
    expect(html).toContain("质量研析尚未开放");
    expect(html).toContain('type="button" disabled title="质量研析功能尚未完成"');
    expect(html).toContain("未创建质量事件，未改变来源状态");
  });

  it("renders formal disposition and an explicit two-step anomaly report flow", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
    });

    expect(html).toContain("正式处置");
    expect(html).toContain("确认标记为普通反馈");
    expect(html).toContain("确认进入待补资料");
    expect(html).toContain("资料已更新");
    expect(html).toContain('id="qualityReportDialog"');
    expect(html).toContain("保存草稿");
    expect(html).toContain("明确提交并创建质量事件");
    expect(html).toContain("查看质量事件");
    expect(html).toContain("PENDING_ANALYSIS: '待质量初析'");
    expect(html).toContain("AI原稿独立留存，人工草稿可编辑");
    expect(html).toContain("正式确认并交接任务规划");
  });

  it("emits syntactically valid inline browser scripts", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
    });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((match) => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    expect(() => scripts.forEach((script) => new Function(script!))).not.toThrow();
  });

  it("renders an administrator quality perspective as explicitly read-only", () => {
    const html = renderQualityTrackingPage({
      role: "employee",
      userId: "admin-1",
      canReport: false,
      isSpecialist: true,
      isBusinessReadOnly: true,
      adminPerspective: "quality_specialist",
    });

    expect(html).toContain("管理员只读查看");
    expect(html).toContain('data-business-readonly="1"');
    expect(html).toContain("质量专员");
    expect(html).toContain("applyBusinessReadOnly");
  });
});
