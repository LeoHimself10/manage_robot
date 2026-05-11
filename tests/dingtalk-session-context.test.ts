import { describe, expect, it } from "vitest";
import {
  nextSessionContextAfterDemoResult,
  type AssignmentSessionState,
  type DingTalkDemoSessionContext,
} from "../src/dingtalk-session-context";
import type { TaskPlanningDemoResult } from "../src/agent/demo/pipeline";

describe("nextSessionContextAfterDemoResult", () => {
  it("clears prior digest when user starts a reset or new task", () => {
    const prior: DingTalkDemoSessionContext = {
      priorDigest: "上一轮任务包：旧任务",
    };
    const result: TaskPlanningDemoResult = {
      status: "CONVERSATION",
      traceId: "test-trace-id",
      responseIntent: "RESET_OR_NEW_TASK",
      assistantMessage: "好的，我们从新任务开始。",
      questions: [],
      missingFields: [],
      clarificationUx: "NON_TASK",
    };

    expect(nextSessionContextAfterDemoResult(result, prior, 300)).toEqual({
      priorDigest: undefined,
      conversationState: expect.objectContaining({
        lastResponseIntent: "RESET_OR_NEW_TASK",
        userRejectedTemplate: true,
      }),
    });
  });

  it("allows assignment state to track in-progress conversation ids", () => {
    const assignmentState: AssignmentSessionState = {
      stage: "AWAITING_DISPATCH_CONFIRM",
      lastAssignmentTraceId: "assignment-trace-1",
      inProgressConversationIds: ["conv-manager", "conv-employee"],
    };

    expect(assignmentState.inProgressConversationIds).toEqual([
      "conv-manager",
      "conv-employee",
    ]);
  });
});
