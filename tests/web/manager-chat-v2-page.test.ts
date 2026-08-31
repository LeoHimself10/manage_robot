import { describe, expect, it } from "vitest";

import { renderAdminWorkbenchPage } from "../../src/web/admin-workbench-pages";
import { renderEmployeeWorkbenchPage } from "../../src/web/employee-workbench-pages";
import {
  renderManagerChatPage,
  renderManagerTasksPage,
} from "../../src/web/manager-workbench-pages";
import { renderQualityTrackingPage } from "../../src/web/quality-tracking-page";

describe("manager smart planning assistant v2 page", () => {
  it("renders the isolated planning layout and existing integration points", () => {
    const html = renderManagerChatPage({
      threadId: "main",
      threadKind: "main",
      userLabel: "主管",
      sessionUserId: "manager-1",
    });

    expect(html).toContain("manager-chat-v2-page");
    expect(html).toContain('id="planningContextCard"');
    expect(html).toContain('id="planningDraftBoard"');
    expect(html).toContain('id="planningPersonModalOverlay"');
    expect(html).toContain('id="draftPreviewList"');
    expect(html).toContain("/api/workbench/manager/contacts?keyword=");
    expect(html).toContain("/api/workbench/conversation/send");
    expect(html).toContain("/static/workbench-draft-grid.js");
    expect(html).toContain("确认分配并发放");
    expect(html).toContain("请先核对通讯录，再更新当前草案指派");
    expect(html).toContain("/api/workbench/conversation/draft/assign");
    expect(html).toContain("qualityPanelOpen = 'people'");
    expect(html).toContain("isQuality ? '方案配置中心' : '分配摘要'");
    expect(html).toContain('data-quality-pick-task=');
    expect(html).toContain("本次选择只影响当前任务，不发送聊天消息，也不会批量指派");
    expect(html).toContain("var assignButton = isQuality");
    expect(html).toContain("qualityHandoff.qualityEventId");
    expect(html).toContain("质量事件交接 · 只读");
    expect(html).toContain('id="qualityHistoryToggle" hidden');
    expect(html).toContain('id="qualityPlanningSuggestions"');
    expect(html).toContain('id="draftPanelTitleText"');
    expect(html).toContain("document.body.classList.toggle('quality-planning-mode', isQuality)");
  });

  it("keeps all new CSS scoped to the manager chat body", () => {
    const html = renderManagerChatPage({});

    expect(html).toContain("body.manager-chat-v2-page .chat-main.manager-chat-v2");
    expect(html).toContain("body.manager-chat-v2-page .chat-main.manager-chat-v2.is-quality-planning");
    expect(html).toContain("body.manager-chat-v2-page .quality-panel-section-head");
    expect(html).toContain("body.manager-chat-v2-page .quality-person-row");
    expect(html).toContain("body.manager-chat-v2-page.quality-planning-mode .wb-modal .btn-primary");
    expect(html).not.toMatch(/(^|\n)\.planning-task-card\s*\{/);
    expect(html).not.toMatch(/(^|\n)\.planning-context-card\s*\{/);
    expect(html).not.toMatch(/(^|\n)\.quality-planning-enhancer\s*\{/);
  });

  it("does not inject the assistant layout into existing workbench modules", () => {
    const existingPages = [
      renderManagerTasksPage({ userLabel: "主管" }),
      renderAdminWorkbenchPage({ userLabel: "管理员" }),
      renderEmployeeWorkbenchPage({ sessionUserId: "employee-1" }),
      renderQualityTrackingPage({
        role: "manager",
        userId: "manager-1",
        userLabel: "主管",
      }),
    ];

    for (const html of existingPages) {
      expect(html).not.toContain("manager-chat-v2-page");
      expect(html).not.toContain('id="planningDraftBoard"');
      expect(html).not.toContain("--mc-navy");
    }
  });

  it("keeps explicit deep-link draft editing without enabling automatic editing by default", () => {
    const defaultHtml = renderManagerChatPage({ openDraftEditor: false });
    const deepLinkHtml = renderManagerChatPage({ openDraftEditor: true });

    expect(defaultHtml).toContain("var pendingOpenDraftEditor = false");
    expect(deepLinkHtml).toContain("var pendingOpenDraftEditor = true");
    expect(defaultHtml).toContain("function maybeOpenDraftEditorFromUrl()");
  });
});
