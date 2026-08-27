import { describe, expect, it } from "vitest";
import {
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
    expect(html).toContain("让机器人完善任务规划");
  });

  it("reuses the visible conversation send path only on click and never requests publishing", () => {
    const html = renderManagerChatPage({ threadId: "side-1", threadKind: "side" });
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("必须覆盖已选的全部成果");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("不要把一个成果简单等同于一个任务");
    expect(QUALITY_TASK_REPLAN_MESSAGE).toContain("只生成待确认草案，不要发放");
    expect(html).toContain("qualityPlanningEnhanceBtn.addEventListener('click'");
    expect(html).toContain("sendChatMessage({ message: QUALITY_TASK_REPLAN_MSG, fromComposer: false })");
    expect(html).toContain("qualityPlanningInFlight || sendInFlight || activeThreadKind !== 'side'");
    expect(html).toContain("qualityPlanningInFlight ? '机器人规划中…'");
    expect(html.match(/sendChatMessage\(\{ message: QUALITY_TASK_REPLAN_MSG/g)).toHaveLength(1);
    expect(html).not.toContain("sendChatMessage({ message: QUALITY_TASK_REPLAN_MSG, fromComposer: false });\n  renderQualitySourceContext");
  });
});
