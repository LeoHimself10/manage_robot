import { describe, expect, it } from "vitest";
import { extractLightAssignment, renderLightAssignmentSection } from "../../../src/agent/assignment/light-assignment";

describe("light assignment", () => {
  it("accepts valid minimal assignment payload", () => {
    const result = extractLightAssignment({
      rawAssignment: {
        assignments: [
          {
            taskId: "task_1",
            primary: {
              userId: "emp_qa_001",
              displayName: "张三",
              rationale: "做过类似问题排查",
            },
            confidence: "HIGH",
          },
        ],
      },
      planId: "plan_1",
      traceId: "trace_1",
      modelName: "qwen3.6-plus",
      taskIds: ["task_1", "task_2"],
      employees: [{ userId: "emp_qa_001", displayName: "张三" }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.assignments).toHaveLength(1);
      expect(result.draft.assignments[0]?.taskId).toBe("task_1");
      expect(result.draft.assignments[0]?.confidence).toBe("HIGH");
      const section = renderLightAssignmentSection(result.draft);
      expect(section).toContain("### 分配建议");
      expect(section).toContain("张三");
    }
  });

  it("drops invalid entries and fails when nothing remains", () => {
    const result = extractLightAssignment({
      rawAssignment: {
        assignments: [
          {
            taskId: "task_not_exists",
            primary: {
              userId: "ghost",
              displayName: "不存在",
              rationale: "无",
            },
            confidence: "LOW",
          },
        ],
      },
      planId: "plan_1",
      traceId: "trace_1",
      modelName: "qwen3.6-plus",
      taskIds: ["task_1"],
      employees: [{ userId: "emp_qa_001", displayName: "张三" }],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("no valid assignment entries");
    }
  });
});
