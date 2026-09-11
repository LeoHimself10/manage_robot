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
    expect(html).toContain('"PENDING_ANALYSIS":"待质量初析"');
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
    expect(html).toContain("if (state.listType === 'feedback') return 'ACTION_REQUIRED'");
    expect(html).toContain("function alignWorkspace()");
    expect(html).toContain('data-business-readonly="1"');
    expect(html).toContain("研发中心主管（曹一挥）");
    expect(html).toContain("确认后进入该主管完整工作台，权限与本人登录一致");
    expect(html).toContain("/api/workbench/admin/impersonation");
    expect(html).toContain("applyBusinessReadOnly");
  });

  it("keeps employee quality work read-only and sends execution back to the original employee task page", () => {
    const html = renderQualityTrackingPage({
      role: "employee",
      userId: "QUALITY_TEST_EMPLOYEE_001",
      canReport: false,
      canViewSources: false,
      isBusinessReadOnly: false,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
      isAdmin: true,
      activePerspective: "employee",
      projectedMode: true,
    });

    expect(html).toContain('data-metric-role="employee"');
    expect(html).toContain("我的质量任务");
    expect(html).toContain('data-metric-employee-stage="ASSIGNED"');
    expect(html).toContain("以下状态直接来自原员工任务系统");
    expect(html).toContain("去原员工任务处理");
    expect(html).toContain("if (view.formalTaskProjection) return 'assignment'");
    expect(html).toContain("params.set('employeeStage', employeeStage)");
  });

  it("keeps yesterday's five-stage workspace and adds clear role-specific metric groups", () => {
    const ma = renderQualityTrackingPage({
      role: "manager",
      userId: "aftersales-manager",
      canReport: true,
      canViewSources: true,
      isBusinessReadOnly: false,
      rolePanelsEnabled: true,
      testActorsEnabled: true,
      isAdmin: true,
      activePerspective: "aftersales",
      projectedMode: true,
    });
    const tong = renderQualityTrackingPage({
      role: "employee",
      userId: "quality-specialist",
      canReport: false,
      canViewSources: false,
      isSpecialist: true,
      isBusinessReadOnly: false,
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
      expect(html).toContain("已关闭");
      expect(html).toContain('data-quality-stage="review"');
      expect(html).toContain('data-quality-stage="analysis"');
      expect(html).toContain('data-quality-stage="assignment"');
      expect(html).toContain('data-quality-stage="chain"');
      expect(html).toContain('data-quality-stage="final"');
      expect(html).not.toContain("同一事件，不同职责所需的信息");
    }
    expect(ma).toContain("反馈研判");
    expect(ma).toContain("待我研判");
    expect(ma).toContain("已完成研判");
    expect(ma).toContain("仅包含普通反馈和已通报");
    expect(ma).toContain("row.reportedEvent.status !== 'DRAFT'");
    expect(ma).toContain("data.reportEvent.status !== 'DRAFT'");
    expect(ma).toContain("通报后跟踪");
    expect(ma).toContain("AI 原始研判建议");
    expect(ma).toContain("主管最终研判");
    expect(tong).toContain("待我初析");
    expect(tong).toContain("任务推进中");
    expect(tong).toContain("待质量终验");
    expect(tong).toContain("正式通报事件事实");
    expect(tong).toContain("var qualityStage = String(view.defaultStage || '')");
    expect(tong).toContain("['review','analysis','assignment','chain','final'].indexOf(qualityStage) >= 0");
    const tongStageNavigation = tong.match(
      /<nav class="qpc-stages[^"]*" aria-label="质量处理阶段">([\s\S]*?)<\/nav>/,
    )?.[0] ?? "";
    expect(tongStageNavigation.match(/data-quality-stage=/g)).toHaveLength(5);
    expect(tongStageNavigation).not.toContain("is-four-stage");
    expect(tongStageNavigation).toContain("任务分配结果");
    expect(tongStageNavigation).toContain("责任结构与证据");
    expect(tongStageNavigation).toContain("并行任务 · 证据归档");
    expect(tongStageNavigation).not.toContain("任务分配与验收");
    expect(tong).toContain("switchStage('assignment')");
    expect(tong).toContain("function changeListPage(nextPage)");
    expect(tong).toContain("function scrollToQualityList()");
    expect(tong).toContain("title.scrollIntoView({ behavior: 'smooth', block: 'start' })");
    expect(tong).toContain("await loadList(); scrollToQualityList();");
    expect(tong).toContain("qpc-event-summary-grid");
    expect(tong).not.toContain("'事件概览'");
    expect(tong).toContain("'质量研判'");
    expect(tong).toContain("[panelPerspective === 'manager' ? '质量事件状态' : '当前状态', event.statusLabel]");
    expect(tong).toContain("if (!isAftersalesPerspective)");
    expect(tong).not.toContain("renderProjectedOriginalAiAction(view, ai)");
    expect(tong).toContain("AI回填与人工确认");
    expect(tong).toContain("panel.id = 'projectedHumanAssessmentForm'");
    expect(tong).toContain("aiButton.id = 'projectedRunAiAssessment'");
    expect(tong).toContain("'btn qpc-ai-trigger'");
    expect(tong).toContain("AI建议已回填，请核对分类和是否属于质量事件后保存");
    expect(tong).toContain("applySuggestion(currentSuggestion, 'DIRECT')");
    expect(tong).toContain("setAdoptionMode('MODIFIED')");
    expect(tong).toContain("await selectEvent(view.event.actionRef, true, true)");
    expect(tong).toContain("if (!preserveScroll) alignWorkspace()");
    expect(tong).toContain("window.scrollTo({ top: savedScrollTop, behavior: 'auto' })");
    expect(tong).toContain("if (view.assessment && !isAftersalesPerspective)");
    expect(tong).toContain("直接采纳");
    expect(tong).toContain("修改后采纳");
    expect(tong).toContain("qpc-ai-card");
    expect(tong).toContain("原始快照 · 不可修改");
  });

  it("shows the five action-oriented buckets for the isolated test supervisor", () => {
    const previous = process.env.WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED;
    process.env.WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED = "1";
    try {
      const html = renderQualityTrackingPage({
        role: "manager",
        userId: "QUALITY_TEST_MANAGER_001",
        canReport: false,
        canViewSources: false,
        isBusinessReadOnly: false,
        rolePanelsEnabled: true,
        activePerspective: "manager",
        activeTestActor: "manager-1",
        projectedMode: true,
      });
      const stageNavigation = html.match(
        /<nav class="qpc-stages[^"]*" aria-label="质量处理阶段">([\s\S]*?)<\/nav>/,
      )?.[0] ?? "";
      const managerRenderer = html.match(
        /function renderManagerAssignmentDetails\(view, mount\)([\s\S]*?)function renderManagerReviewGate/,
      )?.[0] ?? "";
      expect(html).toContain('data-metric-role="supervisor"');
      expect(html).toContain('data-metric-manager-stage="ACCEPT"');
      expect(html).toContain("待我承接");
      expect(html).toContain("待分派员工");
      expect(html).toContain("待员工承接");
      expect(html).toContain("员工执行中");
      expect(html).toContain("待我验收");
      expect(html).toContain("已关闭");
      expect(html).toContain("if (panelPerspective !== 'manager' && panelPerspective !== 'employee') statusCell.appendChild(make('small', 'qpc-meta', statusText))");
      expect(html).toContain("'员工／分配事项'");
      expect(html).toContain("function renderManagerAssignmentCell(item)");
      expect(html).toContain("function renderManagerAssignmentDetails(view, mount)");
      expect(html).toContain("function renderResponsibilityRoot(mount, config)");
      expect(html).toContain("function renderResponsibilityTaskList(view, items, mount, mode)");
      expect(html).toContain("MY RESPONSIBILITY");
      expect(html).toContain("我负责的员工任务");
      expect(html).toContain("只展示由当前主管负责的正式员工任务");
      expect(html).toContain("function isManagerFormalAssignmentItem(item)");
      expect(html).toContain("item.formalProjection || item.taskUrl || item.taskNo");
      expect(html).toContain("managerMode ? (Array.isArray(item.evidence) ? item.evidence : []) : qualityTaskEvidence(view, item)");
      expect(html).toContain("reviewLabel === '验收通过' && String(item.statusLabel || '') === reviewLabel ? '已完成'");
      expect(html).toContain("['业务编号', value(view.event && view.event.eventNumber)]");
      expect(html).not.toContain("['任务编号', value(item.taskNo)]");
      expect(html).not.toContain("function renderManagerSupervisorTask(view, mount)");
      expect(html).not.toContain("主管承接的质量任务");
      expect(html).not.toContain("质量人员交办内容固定保留");
      expect(html).not.toContain("查看原任务分配");
      expect(html).toContain("function openManagerFormalTask(view, item, taskLink)");
      expect(html).toContain("targetUserId: view.actorUserId");
      expect(stageNavigation.match(/data-quality-stage=/g)).toHaveLength(6);
      expect(stageNavigation).not.toContain("is-four-stage");
      expect(stageNavigation).toContain("分配与承办");
      expect(stageNavigation).toContain("终验与审计");
      expect(stageNavigation).toContain('data-quality-stage="chain"');
      expect(stageNavigation).toContain('data-quality-stage="assessment"');
      expect(stageNavigation).toContain("责任链与证据");
      expect(html).toContain("分派、申请处理和验收统一回到原主管任务页完成。");
      expect(html).toContain("当前仅展示“");
      expect(html).toContain("查看其他阶段任务（");
      expect(html).toContain("renderResponsibilityTaskList(view, otherItems, body, 'manager')");
      expect(html).not.toContain("查看我负责的全部任务（");
      expect(html).toContain("去原任务系统重新分派");
      expect(html).toContain("url.searchParams.set('managerStage', state.metricManagerStage)");
      expect(html).toContain("去原主管任务验收");
      expect(html).toContain("state.metricManagerStage === 'REVIEW'");
      expect(html).toContain("isManagerReviewing ? '待我验收任务'");
      expect(html).toContain("isManagerReviewing ? '逐项查看提交'");
      expect(html).toContain("!isManagerReviewing && allowed.indexOf('delegate') >= 0");
      expect(html).toContain("item.managerStage === 'REVIEW' || qualityTaskReviewLabel(item) === '待主管验收'");
      expect(html).toContain("if (view.perspective !== 'manager') renderProjectedClosure(view, finalStage)");
      expect(html).toContain("Array.isArray(view.event && view.event.assignmentItems)");
      expect(html).toContain("panelPerspective === 'manager' ? '质量事件状态' : '当前状态'");
      expect(managerRenderer).toContain("view.event && view.event.assignmentItems");
      expect(managerRenderer).toContain("filter(isManagerFormalAssignmentItem)");
      expect(managerRenderer).toContain("item.managerStage !== state.metricManagerStage");
      expect(managerRenderer).not.toContain("view.qualityAssignmentItems");
      expect(managerRenderer).not.toContain("view.evidence");
      expect(managerRenderer).not.toContain("renderProjectedClosure");
    } finally {
      if (previous == null) delete process.env.WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED;
      else process.env.WORKBENCH_ADMIN_TEST_SYSTEM_ENABLED = previous;
    }
  });

  it("suppresses legacy supervisor actions in REVIEW without changing ACCEPT or DELEGATE", () => {
    const html = renderQualityTrackingPage({
      role: "manager",
      userId: "QUALITY_TEST_MANAGER_001",
      canReport: false,
      canViewSources: false,
      rolePanelsEnabled: true,
      activePerspective: "manager",
      activeTestActor: "manager-1",
      projectedMode: true,
    });
    const actionRenderer = html.match(
      /function renderProjectedTestActions\(view, mount\)([\s\S]*?)function renderProjectedClosure/,
    )?.[0] ?? "";
    const stageRenderer = html.match(
      /function renderProjectedEventStages\(view\)([\s\S]*?)function projectedDefaultStage/,
    )?.[0] ?? "";

    expect(actionRenderer).toContain("if (view.perspective === 'manager' && state.metricManagerStage === 'REVIEW') return");
    expect(stageRenderer).toContain("isManagerReceiving = view.perspective === 'manager' && !isManagerReviewing");
    expect(stageRenderer).toContain("isManagerDelegating = view.perspective === 'manager' && !isManagerReviewing");
    expect(stageRenderer).toContain("isManagerReviewing ? '待我验收任务'");
    expect(stageRenderer).toContain("isManagerReviewing ? '逐项查看提交'");

    expect(actionRenderer).toContain("allowed.indexOf('accept') >= 0");
    expect(actionRenderer).toContain("void run('accept')");
    expect(actionRenderer).toContain("if (isDelegating)");
    expect(actionRenderer).toContain("void run('open-planning')");
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

    expect(html).toContain("待我初析");
    expect(html).toContain("任务推进中");
    expect(html).toContain("待质量终验");
    expect(html).toContain("已关闭");
    expect(html).toContain("质量初析工作区");
    expect(html).toContain("renderQualityAnalysisStage(editableAnalysis)");
    expect(html).toContain("renderProjectedSupervisorPicker(view, assignment)");
    expect(html).not.toContain("质量事件查看视角");
  });

  it("renders Tong Cheng's responsibility structure as parallel task cards with controlled evidence previews", () => {
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
    const renderer = html.match(
      /function renderQualityManagementResponsibility\(view, mount\)([\s\S]*?)function renderProjectedOrdinaryStages/,
    )?.[0] ?? "";

    expect(html).toContain('id="qualityEvidenceDialog"');
    expect(html).toContain('id="qualityEvidencePreview"');
    expect(html).toContain("function renderQualityManagementResponsibility(view, mount)");
    expect(html).toContain("PRIMARY OWNER");
    expect(html).toContain("同级并行任务");
    expect(html).toContain("每张卡片代表一项正式任务；没有正式依赖记录的任务不画顺序箭头。");
    expect(html).toContain("无正式依赖（同级并行）");
    expect(html).toContain("证据与历史版本");
    expect(html).toContain("历史记录不会被覆盖");
    expect(html).toContain("qualityDependencyLabels(item, items)");
    expect(html).toContain("qualityTaskReviewLabel(item)");
    expect(html).toContain("function qualityTaskDisplayTitle(item)");
    expect(html).toContain("任务名称待补充");
    expect(html).toContain("void openEvidencePreview(record, displayTitle, reviewLabel, versionLabel)");
    expect(html).toContain("kind === 'image'");
    expect(html).toContain("kind === 'text'");
    expect(html).toContain("qpc-evidence-frame");
    expect(html).toContain("此文件类型暂不支持在线预览，请下载原文件查看。");
    expect(html).toContain("质量终验门禁尚未满足");
    expect(renderer).toContain("view.supervisorAssignment");
    expect(renderer).toContain("view.qualityAssignmentItems");
    expect(renderer).toContain("renderResponsibilityTaskList(view, items, structure, 'quality')");
    expect(renderer).not.toContain("qpc-chain-node");
    expect(renderer).not.toContain('content: "→"');
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
    expect(test).not.toContain('data-quality-list="feedback"');
    expect(test).toContain("function projectedDefaultStage(view)");
    expect(test).toContain("panel.id = 'projectedHumanAssessmentForm'");
    expect(test).toContain("aiButton.id = 'projectedRunAiAssessment'");
    expect(test).toContain("是否属于质量事件 *");
    expect(test).toContain("是，属于质量事件");
    expect(test).toContain("否，属于普通事件");
    expect(test).toContain("projectedPrimaryCategory");
    expect(test).toContain("projectedSecondaryCategory");
    expect(test).toContain("urgency.id = 'projectedRiskLevel'");
    expect(test).toContain("urgency.appendChild(new Option('请选择风险等级', ''))");
    expect(test).toContain("urgency.value = saved && saved.riskCode || ''");
    expect(test).not.toContain("view.event.urgencyCode || 'MEDIUM'");
    expect(test).toContain("save.id = 'projectedSaveAssessment'");
    expect(test).toContain("confirm.id = 'projectedConfirmAndPushAnalysis'");
    expect(test).toContain("确认并推送质量初析");
    expect(test).toContain("所有员工事项均已通过，系统已自动推送给佟成老师进行质量终验；主管无需在这里执行终验。");
    expect(test).toContain("剩余事项全部通过后，系统才会自动送交佟成老师。");
    expect(test).toContain("保存为普通事件");
    expect(test).toContain("save.value = dispositionCode === 'QUALITY_ANOMALY' ? 'SAVE_DRAFT' : 'CONFIRM'");
    expect(test).toContain("confirm.hidden = dispositionCode !== 'QUALITY_ANOMALY'");
    expect(test).toContain("event.submitter !== confirm ? 'SAVE_DRAFT' : 'CONFIRM'");
    expect(test).toContain("submissionMode: submissionMode");
    expect(test).toContain("研判已保存，尚未推送质量初析。");
    expect(test).toContain("研判已保存，尚未确认推送质量初析。");
    expect(test).toContain("可先保存，确认后才推送质量初析");
    expect(test).toContain("已确认并推送质量初析。");
    expect(test).toContain("var ordinary = dispositionCode === 'ORDINARY'");
    expect(test).toContain("dispositionCode === 'QUALITY_ANOMALY' && adoptionMode !== 'DIRECT'");
    expect(test).not.toContain("下一步：切换佟成（测试）填写质量初析");
    expect(test).toContain("普通事件 · 不进入流程");
    expect(test).toContain("AI研判完成，分类与事件属性建议已回填");
    expect(test).toContain("生成AI质量初析");
    expect(test).toContain("正在结合来源事实、AI原始研判和人工研判生成初析草案");
    expect(test).toContain("完成初析并发送给测试主管");
    expect(test).toContain("正在完成初析并发送给测试主管…");
    expect(test).toContain("本测试流程的唯一主责是“测试主管”");
    expect(test).toContain("发送给测试主管承接");
    expect(test).toContain("承接并进入任务规划");
    expect(test).toContain("退回给佟成（测试）");
    expect(test).toContain("window.location.assign(result.planningUrl)");
    expect(test).toContain("planningMe.userId !== view.actorUserId");
    expect(test).toContain("正在切换测试主管工作台…");
    expect(test).toContain("进入原智能规划助手完成分派");
    expect(test).toContain("void run('open-planning')");
    expect(test).toContain("if (!isDelegating && (allowed.indexOf('upload-evidence')");
    expect(test).not.toContain("分配给本部门测试员工");
    expect(test).not.toContain("window.prompt('请填写拒绝原因')");
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
    expect(regular).toContain("反馈研判");
  });
});
