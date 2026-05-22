import { describe, expect, it } from "vitest";
import { detectFalseAssign, looksLikeFalseAssignClaim } from "../../../src/agent/assignment/false-assign";

describe("false assign detection", () => {
  it("detects false assign claim when coverage incomplete", () => {
    expect(
      detectFalseAssign({
        userMessage: "请点将分配负责人",
        latestDraft: { tasks: [{ id: "task_1" }, { id: "task_2" }] },
        latestAssignment: {
          assignments: [{ taskId: "task_1", primary: { userId: "u1" } }],
        },
        outboundMarkdown: "已完成分配，负责人如下。",
        hasFullAssignmentJson: false,
      }),
    ).toBe(true);
  });

  it("does not flag when coverage is full", () => {
    expect(
      detectFalseAssign({
        userMessage: "请点将",
        latestDraft: { tasks: [{ id: "task_1" }] },
        latestAssignment: {
          assignments: [{ taskId: "task_1", primary: { userId: "u1" } }],
        },
        outboundMarkdown: "已完成分配。",
        hasFullAssignmentJson: true,
      }),
    ).toBe(false);
  });

  it("matches assign success phrases", () => {
    expect(looksLikeFalseAssignClaim("已指派全部子任务负责人。")).toBe(true);
    expect(looksLikeFalseAssignClaim("尚未完成分配")).toBe(false);
  });
});
