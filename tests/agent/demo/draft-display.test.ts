import { describe, expect, it } from "vitest";
import {
  draftHasAssignedTasks,
  enrichDraftAssigneeDisplayNames,
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
});
