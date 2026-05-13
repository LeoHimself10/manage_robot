import { describe, expect, it } from "vitest";
import { coerceAssignmentDraft, validateAssignmentDraft } from "../../../src/agent/assignment/assignment-schema";
import type { AssignmentDraft } from "../../../src/agent/assignment/types";

const VALID_DRAFT: AssignmentDraft = {
  planId: "plan_001",
  traceId: "trace_abc",
  generatedAt: "2026-05-09T00:00:00.000Z",
  promptVersion: "assignment-recommender-agent-v0.3.1",
  modelName: "qwen-plus",
  assignments: [
    {
      taskId: "task_1",
      primary: {
        userId: "emp_qa_001",
        displayName: "张三",
        rationale: "有 8D 经验，tags 包含 root cause analysis",
        evidenceRefs: ["cases[0].outcome=成功关闭"],
      },
      alternates: [
        {
          userId: "emp_qa_002",
          displayName: "李四",
          rationale: "有 QC 7 tools 经验",
          risks: [{ type: "OVERLOAD", description: "当前任务较多" }],
        },
      ],
      confidence: "HIGH",
      confidenceReason: "技能完全匹配",
    },
  ],
  globalRisks: [{ type: "INSUFFICIENT_EVIDENCE", description: "部分员工档案未更新" }],
};

describe("coerceAssignmentDraft", () => {
  it("coerces a valid draft from raw JSON", () => {
    const raw = JSON.parse(JSON.stringify(VALID_DRAFT));
    const draft = coerceAssignmentDraft(raw);
    expect(draft.planId).toBe("plan_001");
    expect(draft.assignments).toHaveLength(1);
    expect(draft.assignments[0].primary.userId).toBe("emp_qa_001");
    expect(draft.assignments[0].alternates).toHaveLength(1);
    expect(draft.globalRisks).toHaveLength(1);
  });

  it("coerces with trimmed strings and removes null fields", () => {
    const raw = {
      planId: "  plan_002  ",
      traceId: null,
      generatedAt: "",
      promptVersion: "v1",
      modelName: "m1",
      assignments: [
        {
          taskId: "t1",
          primary: { userId: "u1", displayName: "n1", rationale: "r1" },
          alternates: [],
          confidence: "MEDIUM",
          confidenceReason: "ok",
        },
      ],
    };
    const draft = coerceAssignmentDraft(raw);
    expect(draft.planId).toBe("plan_002");
    expect(draft.traceId).toBe("");
    expect(draft.assignments).toHaveLength(1);
    expect(draft.assignments[0].alternates).toHaveLength(0);
  });

  it("throws when input is not an object", () => {
    expect(() => coerceAssignmentDraft(null)).toThrow();
    expect(() => coerceAssignmentDraft("string")).toThrow();
    expect(() => coerceAssignmentDraft(42)).toThrow();
    expect(() => coerceAssignmentDraft([])).toThrow();
  });

  it("handles missing assignments gracefully", () => {
    const draft = coerceAssignmentDraft({ planId: "p1" });
    expect(draft.assignments).toEqual([]);
  });
});

describe("validateAssignmentDraft", () => {
  it("passes a valid draft without options", () => {
    const result = validateAssignmentDraft(VALID_DRAFT);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("passes a valid draft with taskIds and allowedUserIds", () => {
    const result = validateAssignmentDraft(VALID_DRAFT, {
      taskIds: ["task_1"],
      allowedUserIds: ["emp_qa_001", "emp_qa_002"],
    });
    expect(result.valid).toBe(true);
  });

  it("fails when confidence is invalid", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        { ...VALID_DRAFT.assignments[0], confidence: "INVALID" as unknown as "HIGH" },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("confidence"))).toBe(true);
  });

  it("fails when taskId is missing", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [{ ...VALID_DRAFT.assignments[0], taskId: "" }],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("taskId"))).toBe(true);
  });

  it("fails when alternates contains primary userId", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        {
          ...VALID_DRAFT.assignments[0],
          alternates: [{ userId: "emp_qa_001", displayName: "张三", rationale: "重复" }],
        },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must not match primary"))).toBe(true);
  });

  it("fails when alternates are empty", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        { ...VALID_DRAFT.assignments[0], alternates: [] },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("alternates"))).toBe(true);
  });

  it("fails when taskId not in allowed list", () => {
    const result = validateAssignmentDraft(VALID_DRAFT, { taskIds: ["task_999"] });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not in allowed taskIds"))).toBe(true);
  });

  it("fails when userId not in allowed list", () => {
    const result = validateAssignmentDraft(VALID_DRAFT, {
      allowedUserIds: ["some_other_user"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("not in allowedUserIds"))).toBe(true);
  });

  it("fails when primary has missing displayName", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        {
          ...VALID_DRAFT.assignments[0],
          primary: { ...VALID_DRAFT.assignments[0].primary, displayName: "" },
        },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("displayName"))).toBe(true);
  });

  it("fails when confidenceReason is empty", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        { ...VALID_DRAFT.assignments[0], confidenceReason: "" },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("confidenceReason"))).toBe(true);
  });

  it("fails when planId is empty", () => {
    const draft = { ...VALID_DRAFT, planId: "" };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("planId"))).toBe(true);
  });

  it("fails when risk type is invalid", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        {
          ...VALID_DRAFT.assignments[0],
          primary: {
            ...VALID_DRAFT.assignments[0].primary,
            risks: [{ type: "UNKNOWN" as "OTHER", description: "test" }],
          },
        },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("risks"))).toBe(true);
  });

  it("fails when assignments is empty array", () => {
    const draft = { ...VALID_DRAFT, assignments: [] };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("assignments"))).toBe(true);
  });

  it("fails when globalRisks contains invalid type", () => {
    const draft = {
      ...VALID_DRAFT,
      globalRisks: [{ type: "BAD_TYPE" as "OTHER", description: "oops" }],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("globalRisks"))).toBe(true);
  });

  it("passes when alternates userId is duplicated", () => {
    const draft = {
      ...VALID_DRAFT,
      assignments: [
        {
          ...VALID_DRAFT.assignments[0],
          alternates: [
            { userId: "emp_qa_002", displayName: "李四", rationale: "r1" },
            { userId: "emp_qa_002", displayName: "李四重复", rationale: "r2" },
          ],
        },
      ],
    };
    const result = validateAssignmentDraft(draft);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicated"))).toBe(true);
  });
});
