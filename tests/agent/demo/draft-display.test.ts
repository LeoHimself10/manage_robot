import { describe, expect, it } from "vitest";
import {
  draftHasAssignedTasks,
  enrichDraftAssigneeDisplayNames,
  guardFalsePublishClaimInMessage,
  messageClaimsPublishedWithoutTool,
  shouldAppendDraftTableFromSession,
  shouldSlimOrchestratorMessageForDraft,
} from "../../../src/agent/demo/draft-display";

describe("draft-display", () => {
  it("enrichDraftAssigneeDisplayNames maps userId to displayName", () => {
    const draft = enrichDraftAssigneeDisplayNames(
      {
        tasks: [{ id: "t1", assigneeUserId: "u1" }],
      },
      (uid) => (uid === "u1" ? "杨楚榛" : undefined),
    );
    const tasks = draft.tasks as Array<Record<string, unknown>>;
    expect(tasks[0].assigneeDisplayName).toBe("杨楚榛");
  });

  it("draftHasAssignedTasks is true when assigneeUserId set", () => {
    expect(
      draftHasAssignedTasks({ tasks: [{ assigneeUserId: "u1" }] }),
    ).toBe(true);
    expect(draftHasAssignedTasks({ tasks: [{ assigneeUserId: "" }] })).toBe(false);
  });

  it("shouldSlimOrchestratorMessageForDraft detects long assignment dump", () => {
    const long =
      `${"以下是完整草案：\n子任务 1：体外模拟\n负责人：杨楚榛\n交付物：报告\n完成标准：复现3次\n".repeat(12)}`;
    expect(long.length).toBeGreaterThan(400);
    expect(shouldSlimOrchestratorMessageForDraft(long)).toBe(true);
    expect(shouldSlimOrchestratorMessageForDraft("已分配，请确认。")).toBe(false);
  });

  it("shouldSlimOrchestratorMessageForDraft detects 以下是针对 and medium 子任务 blocks", () => {
    const octStyle = [
      "以下是针对 A100 OCT 导管的运输整改方案。",
      "子任务 1：现场核查",
      "交付物：报告",
      "完成标准：通过验收",
      ...Array.from({ length: 15 }, (_, i) => `补充说明行 ${i + 1}`),
    ].join("\n");
    expect(shouldSlimOrchestratorMessageForDraft(octStyle)).toBe(true);

    const mediumSubtask = "子任务 1：快检与现场复核\n".repeat(15);
    expect(mediumSubtask.length).toBeGreaterThan(200);
    expect(shouldSlimOrchestratorMessageForDraft(mediumSubtask)).toBe(true);
    expect(shouldSlimOrchestratorMessageForDraft("以下是针对 OCT 的摘要，无子任务。")).toBe(true);
  });

  it("shouldAppendDraftTableFromSession after update_draft_task without freshDraft", () => {
    const draft = { tasks: [{ id: "t1", title: "A", assigneeUserId: "u1" }] };
    expect(
      shouldAppendDraftTableFromSession({
        currentDraft: draft,
        toolInvocationNames: ["update_draft_task"],
      }),
    ).toBe(true);
    expect(
      shouldAppendDraftTableFromSession({
        freshDraft: draft,
        currentDraft: draft,
      }),
    ).toBe(false);
  });

  it("guardFalsePublishClaimInMessage blocks fake publish", () => {
    expect(
      messageClaimsPublishedWithoutTool({
        message: "任务已发布，杨贺新将收到通知。",
        toolInvocationNames: [],
      }),
    ).toBe(true);
    const guarded = guardFalsePublishClaimInMessage("任务已发布，杨贺新将收到通知。", {
      toolInvocationNames: [],
    });
    expect(guarded).toContain("尚未正式发布");
    expect(guarded).not.toContain("将收到通知");
    expect(
      guardFalsePublishClaimInMessage("任务已发布", {
        toolInvocationNames: ["publish_task"],
        publishResult: { ok: true },
      }),
    ).toBe("任务已发布");
  });
});
