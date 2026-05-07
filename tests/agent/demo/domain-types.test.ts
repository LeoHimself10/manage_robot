import { describe, expect, it } from "vitest";
import { createEmptyPlan } from "../../../src/agent/harness/bootstrap";
import { CapaAdvisory } from "../../../src/domain/capa";
import { ClassificationResult } from "../../../src/domain/classification";
import { TaskPackage } from "../../../src/domain/task-package";

describe("demo domain types", () => {
  it("supports CAPA advisory values", () => {
    const advisory: CapaAdvisory = {
      advisory: "RECOMMENDED",
      rationale: ["客户现场反馈且影响范围未确认"],
      disclaimer:
        "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
      promptingQuestions: ["是否涉及已出货产品？"],
    };

    expect(advisory.advisory).toBe("RECOMMENDED");
  });

  it("supports classification metadata", () => {
    const result: ClassificationResult = {
      domain: "QUALITY",
      subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
      confidence: "MEDIUM",
      rationale: ["输入包含客户现场反馈"],
      missingInformation: ["影响批次"],
    };

    expect(result.domain).toBe("QUALITY");
  });

  it("allows demo task packages without owner assignment", () => {
    const task: TaskPackage = {
      id: "task_1",
      title: "问题事实确认",
      objective: "确认问题现象与影响范围",
      collaborators: [],
      inputMaterials: ["客户反馈截图"],
      actions: ["复核问题现象", "确认影响批次"],
      deliverables: ["问题事实确认记录"],
      completionCriteria: ["影响范围有明确边界"],
      timeNode: { checkpoints: ["T+1 输出初步范围"], dueAt: "T+2" },
      feedbackFrequency: "每日",
      risksAndOpenQuestions: ["需确认是否影响已出货产品"],
      dependencyTaskIds: [],
    };

    expect(task.ownerId).toBeUndefined();
  });

  it("allows plan draft demo metadata", () => {
    const plan = createEmptyPlan({
      domain: "QUALITY",
      subType: "PRODUCTION_PROCESS_ABNORMALITY",
      background: "生产异常",
      demoClassification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["输入包含生产异常"],
        missingInformation: [],
      },
    });

    expect(plan.demoClassification?.confidence).toBe("HIGH");
  });
});
