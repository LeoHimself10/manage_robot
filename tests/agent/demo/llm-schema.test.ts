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

  it("coerces simplified qwen payload into normalized structure", () => {
    const normalized = coerceLlmPlanPayload(
      {
        classification: "QUALITY",
        capaAdvisory: {
          advisory: "UNCERTAIN",
          rationale: ["x"],
          disclaimer: CAPA_DISCLAIMER,
          promptingQuestions: [],
        },
        tasks: [
          {
            id: "T1",
            description: "收集测试记录",
            owner: "QE",
            deadline: "24h",
            dependencies: [],
          },
        ],
        openQuestions: ["是否重复发生？"],
      },
      {
        domainHint: "QUALITY",
        background: "生产测试异常",
      }
    );

    const validation = validateLlmPlanPayload(normalized);
    expect(validation.valid).toBe(true);
    expect(normalized.tasks[0].title.length).toBeGreaterThan(0);
    expect(normalized.tasks[0].feedbackFrequency).toBe("每日反馈");
  });

  it("normalizes lowercase classification fields from qwen output", () => {
    const normalized = coerceLlmPlanPayload(
      {
        classification: {
          domain: "quality",
          subtype: "production_process_abnormality",
          confidence: "high",
          rationale: "命中生产异常",
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
            description: "收集测试记录",
          },
        ],
        openQuestions: [],
      },
      {
        domainHint: "QUALITY",
        background: "生产测试异常",
      }
    );

    expect(normalized.classification.domain).toBe("QUALITY");
    expect(normalized.classification.subtype).toBe(
      "PRODUCTION_PROCESS_ABNORMALITY"
    );
    expect(normalized.classification.confidence).toBe("HIGH");
    expect(normalized.classification.rationale.length).toBeGreaterThan(0);
  });
});
