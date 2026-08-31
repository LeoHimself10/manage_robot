import { describe, expect, it } from "vitest";
import {
  QUALITY_ACCEPTANCE_FILL_MESSAGE,
  QUALITY_TASK_REPLAN_MESSAGE,
  renderManagerChatPage,
  shouldOfferQualityTaskReplan,
} from "../../src/web/manager-workbench-pages";

describe("quality planning chat enhancement", () => {
  it("offers the action only for a quality-event side thread", () => {
    expect(shouldOfferQualityTaskReplan({
      threadKind: "side",
      sourceContextKind: "quality_event",
    })).toBe(true);
    expect(shouldOfferQualityTaskReplan({
      threadKind: "main",
      sourceContextKind: "quality_event",
    })).toBe(false);
    expect(shouldOfferQualityTaskReplan({
      threadKind: "side",
      sourceContextKind: "meeting_import",
    })).toBe(false);
  });

  it("keeps the button hidden until runtime context proves it is a quality side thread", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });
    expect(html).toContain('id="qualityPlanningEnhancer" hidden');
    expect(html).toContain("activeQualitySourceContext.kind === 'quality_event'");
    expect(html).toContain("activeThreadKind === 'side'");
    expect(html).toContain("action.hidden = !canOffer");
    expect(html).toContain("先拆解任务，再配置负责人");
    expect(html).toContain("让机器人拆解任务");
    expect(html).toContain("chat-main.is-quality-planning");
    expect(html).toContain("setPlanningContextCollapsed(card, isQuality)");
  });

  it("reuses the visible conversation send path only on click and never requests publishing", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("必须覆盖已选的全部成果");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("不要把一个成果简单等同于一个任务");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("每一项任务都必须同时生成非空的交付物和完成标准");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("不要写入、沿用或调整正式负责人");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("只生成待确认草案，不要发放");
    expect(html).toContain("qualityPlanningEnhanceBtn.addEventListener('click'");
    expect(html).toContain("runQualityPlanningMessage(QUALITY_TASK_REPLAN_MSG)");
    expect(html).toContain("sendChatMessage({ message: message, fromComposer: false })");
    expect(html).toContain("qualityPlanningInFlight || sendInFlight || activeThreadKind !== 'side'");
    expect(html).toContain("qualityPlanningInFlight");
    expect(html).toContain("'正在拆解…'");
    expect(html.match(/runQualityPlanningMessage\(QUALITY_TASK_REPLAN_MSG/g)).toHaveLength(1);
    expect(html).not.toContain("publish_task");
  });

  it("keeps quality assignee selection in the right panel and outside the chat path", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });
    const start = html.indexOf("async function saveQualityPanelAssignee");
    const end = html.indexOf("function bindQualityPanelInteractions", start);
    const directAssignBlock = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(directAssignBlock).toContain("/api/workbench/conversation/draft/assign");
    expect(directAssignBlock).toContain("taskId: taskId");
    expect(directAssignBlock).not.toContain("sendChatMessage");
    expect(html).toContain("data-quality-panel-toggle");
    expect(html).toContain("data-quality-pick-task");
  });

  it("gates quality planning in the order decomposition, assignee, schedule, acceptance, then publish", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });

    expect(html).toContain("var qualityPanelOpen = 'tasks'");
    expect(html).toContain("var taskDecompositionReady = !isQualityDraft || count > 1");
    expect(html).toContain("var assigneeStepReady = taskDecompositionReady");
    expect(html).toContain("var scheduleStepReady = assigneeStepReady");
    expect(html).toContain("var acceptanceStepReady = scheduleStepReady");
    expect(html).toContain("isQualityDraft\n      ? acceptanceStepReady");
    expect(html).toContain("请先完成任务拆解");
    expect(html).toContain("请先完成负责人配置");
    expect(html).toContain("请先完成依赖与期限");
    expect(html).toContain("拆解后配置");
    expect(html).toContain("disabled aria-disabled=\"true\"");
  });

  it("treats an empty predecessor list as a valid parallel task and shows real dependency data", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });

    expect(html).toContain("var scheduleStepReady = assigneeStepReady && missingDue === 0");
    expect(html).not.toContain("&& dependencyReady");
    expect(html).not.toContain("dependencyReady: dependencyReady");
    expect(html).toContain("无前置依赖");
    expect(html).toContain("依赖：");
    expect(html).toContain("期限完整，依赖按实际关系记录");
    expect(html).not.toContain("'依赖任务 ' + idx");
  });

  it("lets the acceptance step auto-fill or directly edit one task without touching chat for manual saves", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });
    const saveStart = html.indexOf("async function saveQualityAcceptanceFields");
    const saveEnd = html.indexOf("function bindQualityPanelInteractions", saveStart);
    const directSaveBlock = html.slice(saveStart, saveEnd);

    expect(QUALITY_ACCEPTANCE_FILL_MESSAGE).toContain("只补齐当前质量任务草案中缺失的交付物和完成标准");
    expect(QUALITY_ACCEPTANCE_FILL_MESSAGE).toContain("不得修改任务标题、目标、负责人、截止时间、前后依赖");
    expect(html).toContain("4 · 交付物与完成标准");
    expect(html).toContain("员工最后要提交什么");
    expect(html).toContain("主管依据什么判断合格");
    expect(html).toContain("data-quality-ai-acceptance");
    expect(html).toContain("runQualityPlanningMessage(QUALITY_ACCEPTANCE_FILL_MSG)");
    expect(directSaveBlock).toContain("/api/workbench/conversation/draft/acceptance");
    expect(directSaveBlock).not.toContain("sendChatMessage");
  });

  it("offers three quality-only robot adjustments through the same draft update path", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });

    expect(html).toContain('data-quality-command="detail"');
    expect(html).toContain("再拆细原因定位");
    expect(html).toContain('data-quality-command="balance"');
    expect(html).toContain("均衡人员负载");
    expect(html).toContain('data-quality-command="deadline"');
    expect(html).toContain("压缩到 7 天");
    expect(html).toContain("QUALITY_TASK_ADJUSTMENT_MSGS[command]");
    expect(html).toContain("只更新待确认草案，不要发放");
    expect(html).toContain("chip.disabled = !canOffer || qualityPlanningInFlight || sendInFlight || !hasStructuredTasks");
  });
});
