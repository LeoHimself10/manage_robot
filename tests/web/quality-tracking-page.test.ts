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
    expect(html).toContain("url.pathname = '/workbench/quality/review'");
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

  it("keeps AI adoption separate from save and exposes the real analysis handoff", () => {
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
    expect(html).not.toContain("质量研析尚未开放");
    expect(html).toContain("质量初析工作区");
    expect(html).toContain("下一步：确认推送主管");
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
    expect(html).toContain('id="qualityReportSubmit">下一步');
    expect(html).toContain("研判已完成");
    expect(html).toContain("是否推送给质量专员进行初析");
    expect(html).toContain('id="qualityReportConfirmFeedback"');
    expect(html).toContain('id="qualityAnalysisConfirmFeedback"');
    expect(html).toContain("state.reportConfirmRequestId = requestId");
    expect(html).toContain("state.analysisConfirmRequestId = requestId");
    expect(html).toContain("推送未完成，请在确认弹窗查看原因并重试");
    expect(html).not.toContain("catch (error) { document.getElementById('qualityReportConfirmDialog').close()");
    expect(html).not.toContain("catch (error) { dialog.close(); var current = document.getElementById('qaFeedback')");
    expect(html).toContain("查看质量事件");
    expect(html).toContain("PENDING_ANALYSIS: '待质量初析'");
    expect(html).toContain("AI原稿独立留存，人工草稿可编辑");
    expect(html).toContain("是否推送给“");
    expect(html).toContain("进入任务规划／分配");
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

  it("renders an administrator selector that enters the concrete manager workbench", () => {
    const html = renderQualityTrackingPage({
      role: "admin",
      userId: "admin-1",
      canReport: false,
      isSpecialist: false,
      isBusinessReadOnly: true,
      planningMode: true,
      selectedManagerUserId: "manager-1",
      managerPerspectives: [{
        departmentId: "dept-1",
        departmentName: "研发中心",
        managerUserId: "manager-1",
        managerName: "曹一挥",
        label: "研发中心主管（曹一挥）",
      }],
    });

    expect(html).toContain("管理员全局质量视图");
    expect(html).toContain('data-business-readonly="1"');
    expect(html).toContain("研发中心主管（曹一挥）");
    expect(html).toContain("确认后进入该主管完整工作台，权限与本人登录一致");
    expect(html).toContain("/api/workbench/admin/impersonation");
    expect(html).toContain("applyBusinessReadOnly");
  });
});
