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
    expect(html).toContain("if (type === 'feedback' && !canViewSources) return");
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
    expect(html).toContain("仅展示已配置唯一有效主管的真实部门");
    expect(html).not.toContain("协同部门（可多选）");
    expect(html).toContain("生成超时，本次未形成AI原稿");
    expect(html).not.toContain("项目默认Qwen模型");
    expect(html).not.toContain("AI原始结构化输出");
    expect(html).not.toContain("Token与耗时");
    expect(html).not.toContain("value(item.actorUserId)");
    expect(html).not.toContain("value(item.action)");
    expect(html).not.toContain("value(review.decidedBy)");
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
      canViewSources: true,
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
    expect(html).toContain('data-can-view-sources="1"');
    expect(html).toContain("if (state.listType === 'feedback') return 'PENDING'");
    expect(html).toContain("function alignWorkspace()");
    expect(html).toContain('data-business-readonly="1"');
    expect(html).toContain("研发中心主管（曹一挥）");
    expect(html).toContain("确认后进入该主管完整工作台，权限与本人登录一致");
    expect(html).toContain("/api/workbench/admin/impersonation");
    expect(html).toContain("applyBusinessReadOnly");
  });

  it("keeps yesterday's rich classification cards and five-stage workspace in every added perspective", () => {
    const ma = renderQualityTrackingPage({
      role: "admin",
      userId: "admin-1",
      canReport: false,
      canViewSources: true,
      isBusinessReadOnly: true,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
      isAdmin: true,
      activePerspective: "aftersales",
      projectedMode: true,
    });
    const tong = renderQualityTrackingPage({
      role: "admin",
      userId: "admin-1",
      canReport: false,
      canViewSources: false,
      isSpecialist: true,
      isBusinessReadOnly: true,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
      isAdmin: true,
      activePerspective: "quality_management",
      projectedMode: true,
    });

    for (const html of [ma, tong]) {
      expect(html).toContain("马荣鑫");
      expect(html).toContain("佟成");
      expect(html).toContain("测试");
      expect(html).toContain('id="qualityMetrics"');
      expect(html).toContain("处理中");
      expect(html).toContain("待终验");
      expect(html).toContain("已完成");
      expect(html).toContain("已进入后续流程，尚未闭环");
      expect(html).toContain("所有流程已走通并完成闭环");
      expect(html).toContain('data-quality-stage="review"');
      expect(html).toContain('data-quality-stage="analysis"');
      expect(html).toContain('data-quality-stage="assignment"');
      expect(html).toContain('data-quality-stage="chain"');
      expect(html).toContain('data-quality-stage="final"');
      expect(html).not.toContain("同一事件，不同职责所需的信息");
    }
    expect(ma).toContain("待研判反馈");
    expect(ma).toContain("已人工研判");
    expect(ma).toContain("AI 原始研判建议");
    expect(ma).toContain("主管最终研判");
    expect(tong).toContain("待质量初析");
    expect(tong).toContain("待任务规划");
    expect(tong).toContain("正式通报事件事实");
  });

  it("keeps Tong Cheng's real editable initial-analysis workspace inside the projected view", () => {
    const html = renderQualityTrackingPage({
      role: "employee",
      userId: "quality-specialist",
      canReport: false,
      canViewSources: false,
      isSpecialist: true,
      isBusinessReadOnly: false,
      rolePanelsEnabled: true,
      activePerspective: "quality_management",
      projectedMode: true,
    });

    expect(html).toContain("待质量初析");
    expect(html).toContain("处理中");
    expect(html).toContain("已完成");
    expect(html).toContain("质量初析工作区");
    expect(html).toContain("renderQualityAnalysisStage(editableAnalysis)");
    expect(html).toContain("renderProjectedSupervisorPicker(view, assignment)");
    expect(html).not.toContain("质量事件查看视角");
  });

  it("keeps Ma Rongxin's real source workflow and adds the event projection with AI and final review", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "aftersales-manager",
      canReport: true,
      canViewSources: true,
      isSpecialist: false,
      isBusinessReadOnly: false,
      rolePanelsEnabled: true,
      activePerspective: "aftersales",
      projectedMode: true,
    });

    expect(html).toContain('data-quality-list="feedback"');
    expect(html).toContain("AI原始建议状态");
    expect(html).toContain("AI 原始研判建议");
    expect(html).toContain("主管最终研判");
    expect(html).not.toContain("质量事件查看视角");
  });

  it("shows exactly six isolated perspectives to admins and none to ordinary users", () => {
    const test = renderQualityTrackingPage({
      role: "admin",
      userId: "admin-1",
      isAdmin: true,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
      activeTestActor: "employee-1",
      projectedMode: true,
    });
    const navigation = test.match(
      /<nav class="qpc-perspective-tabs" aria-label="管理员隔离测试视角">([\s\S]*?)<\/nav>/,
    )?.[1] ?? "";
    const labels = [
      "马荣鑫（测试）",
      "佟成（测试）",
      "测试员工1",
      "测试员工2",
      "测试员工3",
      "测试主管",
    ];
    expect(labels.every((label) => navigation.includes(label))).toBe(true);
    expect(labels.map((label) => navigation.indexOf(label)))
      .toEqual([...labels.keys()].map((_, index) => navigation.indexOf(labels[index]!)).sort((a, b) => a - b));
    expect(navigation.match(/<a /g)).toHaveLength(6);
    expect(navigation).not.toContain("主管一（测试）");
    expect(navigation).not.toContain("主管二（测试）");
    expect(navigation).not.toContain("测试看板");
    expect(navigation).not.toContain("?perspective=");
    expect(test).toContain("待我处理");
    expect(test).toContain("当前角色可以直接操作");
    expect(test).toContain("已提交，正在等待后续角色");
    expect(test).toContain('data-metric-bucket="TODO"');
    expect(test).toContain('data-metric-bucket="PROGRESS"');
    expect(test).toContain('data-metric-bucket="DONE"');
    expect(test).not.toContain('data-quality-list="feedback"');
    expect(test).toContain("function projectedDefaultStage(view)");
    expect(test).toContain("马荣鑫（测试）· 研判修订");
    expect(test).toContain("运行AI原始研判");
    expect(test).toContain("刷新页面不会重复调用");
    expect(test).toContain("生成AI质量初析");
    expect(test).toContain("正在结合来源事实、AI原始研判和人工研判生成初析草案");
    expect(test).toContain("完成初析，进入主管选择");
    expect(test).toContain("隔离测试只提供“测试主管”");
    expect(test).toContain("details.open = view.scope === 'test'");
    expect(test).toContain("当前可操作");

    const regular = renderQualityTrackingPage({
      role: "manager",
      userId: "after",
      canReport: true,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
    });
    expect(regular).not.toContain("管理员隔离测试视角");
    expect(regular).not.toContain("测试员工1");
    expect(regular).toContain("待研判反馈");
  });
});
