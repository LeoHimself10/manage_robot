import { describe, expect, it } from "vitest";
import {
  assignmentMatchesPlan,
  resolveSessionAssignmentForTurn,
  resolveTurnLatestAssignment,
  scopeSwitchedThisTurn,
} from "../../../src/agent/assignment/resolve-turn-assignment";

describe("resolve-turn-assignment", () => {
  it("assignmentMatchesPlan rejects mismatched planId", () => {
    expect(
      assignmentMatchesPlan({ planId: "plan-old", assignments: [] }, "plan-new"),
    ).toBe(false);
    expect(
      assignmentMatchesPlan({ planId: "plan-a", assignments: [] }, "plan-a"),
    ).toBe(true);
    expect(assignmentMatchesPlan({ assignments: [] }, "plan-a")).toBe(true);
  });

  it("scopeSwitchedThisTurn detects planId change and scope tools", () => {
    expect(
      scopeSwitchedThisTurn({
        preTurnPlanId: "p1",
        sessionPlanId: "p2",
        toolInvocationNames: [],
      }),
    ).toBe(true);
    expect(
      scopeSwitchedThisTurn({
        preTurnPlanId: "p1",
        sessionPlanId: "p1",
        toolInvocationNames: ["start_new_task"],
      }),
    ).toBe(true);
    expect(
      scopeSwitchedThisTurn({
        preTurnPlanId: "p1",
        sessionPlanId: "p1",
        toolInvocationNames: ["bulk_assign_tasks"],
      }),
    ).toBe(false);
  });

  it("does not fall back to preTurnAssignment after scope switch", () => {
    const stale = {
      planId: "old-plan",
      assignments: [{ taskId: "task_1", primary: { displayName: "朱锐" } }],
    };
    expect(
      resolveTurnLatestAssignment({
        preTurnAssignment: stale,
        sessionPlanId: "new-plan",
        preTurnPlanId: "old-plan",
        toolInvocationNames: ["start_new_task"],
      }),
    ).toBeUndefined();
  });

  it("keeps preTurnAssignment on same plan when session has no assignment", () => {
    const samePlan = {
      assignments: [{ taskId: "task_1", primary: { displayName: "李嘉男" } }],
    };
    expect(
      resolveTurnLatestAssignment({
        preTurnAssignment: samePlan,
        sessionPlanId: "plan-a",
        preTurnPlanId: "plan-a",
        toolInvocationNames: ["prepare_publish_task"],
      }),
    ).toEqual(samePlan);
  });

  it("prefers assignStateLatest on same plan", () => {
    const fromState = {
      assignments: [{ taskId: "task_1", primary: { displayName: "崔枭" } }],
    };
    const preTurn = {
      assignments: [{ taskId: "task_1", primary: { displayName: "旧人" } }],
    };
    expect(
      resolveTurnLatestAssignment({
        assignStateLatest: fromState,
        preTurnAssignment: preTurn,
        sessionPlanId: "plan-a",
        preTurnPlanId: "plan-a",
      }),
    ).toEqual(fromState);
  });

  it("resolveSessionAssignmentForTurn prefers post-tool session assignment", () => {
    const session = {
      assignments: [{ taskId: "task_1", primary: { displayName: "李嘉男" } }],
    };
    expect(
      resolveSessionAssignmentForTurn({
        sessionLatest: session,
        preTurnAssignment: undefined,
        sessionPlanId: "plan-a",
        preTurnPlanId: "plan-a",
        toolInvocationNames: ["bulk_assign_tasks", "prepare_publish_task"],
      }),
    ).toEqual(session);
  });
});
