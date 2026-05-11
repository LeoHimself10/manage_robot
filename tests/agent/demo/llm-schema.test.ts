import { describe, expect, it } from "vitest";
import { CAPA_DISCLAIMER } from "../../../src/domain/capa";
import {
  coerceLlmPlanPayload,
  validateLlmPlanPayload,
} from "../../../src/agent/demo/llm-schema";

describe("validateLlmPlanPayload", () => {
  it("accepts a valid payload", () => {
    const result = validateLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["命中生产场景"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "问题事实确认",
          objective: "确认问题事实",
          collaborators: [],
          inputMaterials: ["生产记录"],
          actions: ["收集证据"],
          deliverables: ["问题确认记录"],
          completionCriteria: ["事实明确"],
          timeNode: {
            checkpoints: ["完成事实确认"],
            dueAt: "T+1 工作日",
          },
          feedbackFrequency: "每日反馈",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: ["是否重复发生"],
    });

    expect(result.valid).toBe(true);
  });

  it("rejects payload when tasks are missing", () => {
    const result = validateLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["命中生产场景"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("tasks must contain at least one task");
  });

  it("rejects QUALITY payload without capaAdvisory", () => {
    const result = validateLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "t",
          objective: "o",
          collaborators: [],
          inputMaterials: ["i"],
          actions: ["a"],
          deliverables: ["d"],
          completionCriteria: ["c"],
          timeNode: { checkpoints: [], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("capaAdvisory"))).toBe(true);
  });

  it("rejects RD payload with capaAdvisory", () => {
    const result = validateLlmPlanPayload({
      classification: {
        domain: "RD",
        subtype: "SOLUTION_DEVELOPMENT",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "NOT_REQUIRED",
        rationale: [],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "t",
          objective: "o",
          collaborators: [],
          inputMaterials: ["i"],
          actions: ["a"],
          deliverables: ["d"],
          completionCriteria: ["c"],
          timeNode: { checkpoints: [], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("RD"))).toBe(true);
  });

  it("maps deadline and dependencies aliases without inferring titles from description", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          id: "T1",
          title: "收集测试记录",
          objective: "完成记录收集",
          owner: "QE",
          deadline: "24h",
          dependencies: [],
          collaborators: [],
          inputMaterials: ["记录"],
          actions: ["收集"],
          deliverables: [],
          completionCriteria: [],
          timeNode: { checkpoints: [], dueAt: "" },
          feedbackFrequency: "",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: ["是否重复发生？"],
    });

    const validation = validateLlmPlanPayload(normalized);
    expect(validation.valid).toBe(true);
    expect(normalized.tasks[0].title).toBe("收集测试记录");
    expect(normalized.tasks[0].deliverables).toEqual([]);
    expect(normalized.tasks[0].completionCriteria).toEqual([]);
    expect(normalized.tasks[0].timeNode.dueAt).toBe("24h");
    expect(normalized.tasks[0].feedbackFrequency).toBe("");
  });

  it("falls back to UNCERTAIN for non-enum capa advisory strings", () => {
    const normalized = coerceLlmPlanPayload(
      {
        classification: {
          domain: "QUALITY",
          subtype: "PRODUCTION_PROCESS_ABNORMALITY",
          confidence: "HIGH",
          rationale: ["产线异常"],
          missingInformation: [],
        },
        capaAdvisory: {
          advisory: "建议开启 CAPA 进一步评估",
          rationale: ["影响批次"],
          disclaimer: CAPA_DISCLAIMER,
          promptingQuestions: [],
        },
        tasks: [
          {
            id: "t1",
            title: "x",
            objective: "y",
            collaborators: [],
            inputMaterials: ["i"],
            actions: ["a"],
            deliverables: ["d"],
            completionCriteria: ["c"],
            timeNode: { checkpoints: [], dueAt: "48h" },
            feedbackFrequency: "每日",
            risksAndOpenQuestions: [],
            dependencyTaskIds: [],
          },
        ],
        openQuestions: [],
      }
    );

    expect(normalized.capaAdvisory?.advisory).toBe("UNCERTAIN");
  });

  it("allows empty tasks when validating NEEDS_MORE_INFO shaped payloads", () => {
    const result = validateLlmPlanPayload(
      {
        classification: {
          domain: "QUALITY",
          subtype: "QUALITY_OTHER_OR_UNCERTAIN",
          confidence: "LOW",
          rationale: ["信息不足"],
          missingInformation: ["问题来源"],
        },
        capaAdvisory: {
          advisory: "INSUFFICIENT_INFO",
          rationale: ["背景过短"],
          disclaimer: CAPA_DISCLAIMER,
          promptingQuestions: [],
        },
        tasks: [],
        openQuestions: ["请补充问题来源与现象描述。"],
        gateSelfCheck: { passed: true, missingByTask: [] },
      },
      { allowEmptyTasks: true }
    );

    expect(result.valid).toBe(true);
  });

  it("coerces responseIntent and assistantMessage from model output", () => {
    const normalized = coerceLlmPlanPayload({
      responseIntent: "discuss",
      assistantMessage: "你说得对，这个任务应先确认风险边界。",
      classification: {
        domain: "QUALITY",
        subtype: "QUALITY_OTHER_OR_UNCERTAIN",
        confidence: "LOW",
        rationale: ["围绕上一轮草案讨论"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "INSUFFICIENT_INFO",
        rationale: ["本轮不是正式质量草案"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: [],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });

    expect(normalized.responseIntent).toBe("DISCUSS");
    expect(normalized.assistantMessage).toBe("你说得对，这个任务应先确认风险边界。");
  });

  it("derives compatible intent when responseIntent is omitted", () => {
    const normalized = coerceLlmPlanPayload({
      clarificationUx: "NON_TASK",
      classification: {
        domain: "QUALITY",
        subtype: "QUALITY_OTHER_OR_UNCERTAIN",
        confidence: "LOW",
        rationale: ["寒暄"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "INSUFFICIENT_INFO",
        rationale: ["非任务"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: ["你好，我可以帮你拆解质量或研发任务。"],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });

    expect(normalized.responseIntent).toBe("CHAT");
    expect(normalized.assistantMessage).toBe("你好，我可以帮你拆解质量或研发任务。");
  });

  it("derives DRAFT for omitted responseIntent with high confidence and no questions", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["需进一步确认"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: [],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });

    expect(normalized.responseIntent).toBe("DRAFT");
  });

  it("rejects invalid responseIntent when present", () => {
    const result = validateLlmPlanPayload(
      {
        responseIntent: "MAKE_TABLE_ALWAYS",
        assistantMessage: "x",
        classification: {
          domain: "QUALITY",
          subtype: "QUALITY_OTHER_OR_UNCERTAIN",
          confidence: "LOW",
          rationale: ["x"],
          missingInformation: [],
        },
        capaAdvisory: {
          advisory: "INSUFFICIENT_INFO",
          rationale: ["x"],
          disclaimer: CAPA_DISCLAIMER,
          promptingQuestions: [],
        },
        tasks: [],
        openQuestions: [],
        gateSelfCheck: { passed: true, missingByTask: [] },
      },
      { allowEmptyTasks: true }
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("responseIntent is invalid");
  });

  it("does not hide invalid explicit responseIntent during coercion", () => {
    const normalized = coerceLlmPlanPayload({
      responseIntent: "MAKE_TABLE_ALWAYS",
      assistantMessage: "x",
      classification: {
        domain: "QUALITY",
        subtype: "QUALITY_OTHER_OR_UNCERTAIN",
        confidence: "LOW",
        rationale: ["x"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "INSUFFICIENT_INFO",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: [],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });

    const result = validateLlmPlanPayload(normalized, { allowEmptyTasks: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("responseIntent is invalid");
  });

  it("does not hide non-string explicit responseIntent during coercion", () => {
    const normalized = coerceLlmPlanPayload({
      responseIntent: 123,
      assistantMessage: "x",
      classification: {
        domain: "QUALITY",
        subtype: "QUALITY_OTHER_OR_UNCERTAIN",
        confidence: "LOW",
        rationale: ["x"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "INSUFFICIENT_INFO",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [],
      openQuestions: [],
      gateSelfCheck: { passed: true, missingByTask: [] },
    });

    const result = validateLlmPlanPayload(normalized, { allowEmptyTasks: true });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("responseIntent is invalid");
  });

  it("treats dispatch gate fields as structural strings and arrays, not semantic defaults", () => {
    const result = validateLlmPlanPayload({
      classification: {
        domain: "RD",
        subtype: "SOLUTION_DEVELOPMENT",
        confidence: "MEDIUM",
        rationale: ["x"],
        missingInformation: [],
      },
      tasks: [
        {
          id: "task_1",
          title: "t",
          objective: "o",
          collaborators: [],
          inputMaterials: [],
          actions: [],
          deliverables: [],
          completionCriteria: [],
          timeNode: { checkpoints: [], dueAt: "" },
          feedbackFrequency: "",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: [],
    });

    expect(result.valid).toBe(true);
  });

  it("normalizes lowercase classification fields from qwen output", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "quality",
        subtype: "production_process_abnormality",
        confidence: "high",
        rationale: "命中生产异常",
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          id: "T1",
          title: "收集测试记录",
          objective: "收集",
          collaborators: [],
          inputMaterials: ["i"],
          actions: ["a"],
          deliverables: ["d"],
          completionCriteria: ["c"],
          timeNode: { checkpoints: ["g"], dueAt: "T+1" },
          feedbackFrequency: "每日",
          risksAndOpenQuestions: [],
          dependencyTaskIds: [],
        },
      ],
      openQuestions: [],
    });

    expect(normalized.classification.domain).toBe("QUALITY");
    expect(normalized.classification.subtype).toBe(
      "PRODUCTION_PROCESS_ABNORMALITY"
    );
    expect(normalized.classification.confidence).toBe("HIGH");
    expect(normalized.classification.rationale.length).toBeGreaterThan(0);
    expect(validateLlmPlanPayload(normalized).valid).toBe(true);
  });
});

const minimalRdTask = {
  id: "task_1",
  title: "t",
  objective: "o",
  collaborators: [],
  inputMaterials: ["i"],
  actions: ["a"],
  deliverables: ["d"],
  completionCriteria: ["c"],
  timeNode: { checkpoints: ["g"], dueAt: "T+1" },
  feedbackFrequency: "每日",
  risksAndOpenQuestions: [],
  dependencyTaskIds: [],
};

describe("coerceLlmPlanPayload subtype normalization", () => {
  it("maps VERIFICATION_VALIDATION typo to VERIFICATION_AND_VALIDATION for RD", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "RD",
        subtype: "VERIFICATION_VALIDATION",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      tasks: [minimalRdTask],
      openQuestions: [],
    });

    expect(normalized.classification.subtype).toBe("VERIFICATION_AND_VALIDATION");
    expect(validateLlmPlanPayload(normalized).valid).toBe(true);
  });

  it("remaps RD-specific subtype to QUALITY_OTHER_OR_UNCERTAIN when domain is QUALITY", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "QUALITY",
        subtype: "SOLUTION_DEVELOPMENT",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      capaAdvisory: {
        advisory: "UNCERTAIN",
        rationale: ["x"],
        disclaimer: CAPA_DISCLAIMER,
        promptingQuestions: [],
      },
      tasks: [
        {
          ...minimalRdTask,
          id: "q1",
        },
      ],
      openQuestions: [],
    });

    expect(normalized.classification.subtype).toBe("QUALITY_OTHER_OR_UNCERTAIN");
    expect(validateLlmPlanPayload(normalized).valid).toBe(true);
  });

  it("remaps QUALITY-specific subtype to RD_OTHER_OR_UNCERTAIN when domain is RD", () => {
    const normalized = coerceLlmPlanPayload({
      classification: {
        domain: "RD",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["x"],
        missingInformation: [],
      },
      tasks: [minimalRdTask],
      openQuestions: [],
    });

    expect(normalized.classification.subtype).toBe("RD_OTHER_OR_UNCERTAIN");
    expect(validateLlmPlanPayload(normalized).valid).toBe(true);
  });
});

describe("clarificationUx", () => {
  const thinQualityBase = (): Record<string, unknown> => ({
    classification: {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["x"],
      missingInformation: [],
    },
    capaAdvisory: {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["x"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    },
    tasks: [],
    openQuestions: ["追问"],
  });

  it("coerce preserves NON_TASK and TASK_GAP", () => {
    const a = coerceLlmPlanPayload({ ...thinQualityBase(), clarificationUx: "NON_TASK" });
    expect(a.clarificationUx).toBe("NON_TASK");
    const b = coerceLlmPlanPayload({ ...thinQualityBase(), clarificationUx: "TASK_GAP" });
    expect(b.clarificationUx).toBe("TASK_GAP");
  });

  it("coerce strips invalid clarificationUx", () => {
    const normalized = coerceLlmPlanPayload({ ...thinQualityBase(), clarificationUx: "OTHER" });
    expect(normalized.clarificationUx).toBeUndefined();
  });

  it("validate rejects invalid clarificationUx", () => {
    const result = validateLlmPlanPayload(
      { ...thinQualityBase(), clarificationUx: "OTHER" },
      { allowEmptyTasks: true }
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("clarificationUx"))).toBe(true);
  });
});
