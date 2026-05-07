import { describe, expect, it } from "vitest";
import { createTaskPlanningDemo } from "../../../src/agent/demo/pipeline";
import { toHarnessPlanDraft } from "../../../src/agent/harness/demo-adapter";
import { qualityLlmResult } from "../demo/llm-fixtures";

describe("toHarnessPlanDraft", () => {
  it("maps a demo draft into Harness Plan without dispatching it", async () => {
    const demo = await createTaskPlanningDemo(
      {
        domainHint: "QUALITY",
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      },
      { llmPlanner: async () => qualityLlmResult() }
    );

    if (demo.status !== "DRAFT_READY") {
      throw new Error("expected demo draft");
    }

    const plan = toHarnessPlanDraft({
      id: "plan_demo_1",
      initiatorId: "manager_1",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      demo,
      createdAt: "2026-05-07T04:00:00.000Z",
    });

    expect(plan.status).toBe("DRAFT");
    expect(plan.domain).toBe("QUALITY");
    expect(plan.subType).toBe("PRODUCTION_PROCESS_ABNORMALITY");
    expect(plan.taskPackages.length).toBeGreaterThan(0);
    expect(plan.demoClassification?.subtype).toBe(
      "PRODUCTION_PROCESS_ABNORMALITY"
    );
    expect(plan.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
  });

  it("clones demo output so plan mutations do not mutate the demo result", async () => {
    const demo = await createTaskPlanningDemo(
      {
        domainHint: "QUALITY",
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      },
      { llmPlanner: async () => qualityLlmResult() }
    );

    if (demo.status !== "DRAFT_READY") {
      throw new Error("expected demo draft");
    }

    const originalQuestions = [...demo.questions];
    const originalDeliverables = [...demo.tasks[0].deliverables];
    const originalRationale = [...demo.classification.rationale];
    const originalPromptingQuestions = [
      ...(demo.capaAdvisory?.promptingQuestions ?? []),
    ];

    const plan = toHarnessPlanDraft({
      id: "plan_demo_1",
      initiatorId: "manager_1",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      demo,
      createdAt: "2026-05-07T04:00:00.000Z",
    });

    if (!plan.demoClassification || !plan.capaAdvisory) {
      throw new Error("expected demo metadata on plan");
    }

    plan.constraints.push("mutated constraint");
    plan.taskPackages[0].deliverables.push("mutated deliverable");
    plan.demoClassification.rationale.push("mutated rationale");
    plan.capaAdvisory.promptingQuestions.push("mutated CAPA question");

    expect(demo.questions).toEqual(originalQuestions);
    expect(demo.tasks[0].deliverables).toEqual(originalDeliverables);
    expect(demo.classification.rationale).toEqual(originalRationale);
    expect(demo.capaAdvisory?.promptingQuestions).toEqual(
      originalPromptingQuestions
    );
  });
});
