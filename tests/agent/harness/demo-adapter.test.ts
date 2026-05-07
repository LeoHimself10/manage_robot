import { describe, expect, it } from "vitest";
import { createTaskPlanningDemo } from "../../../src/agent/demo/pipeline";
import { toHarnessPlanDraft } from "../../../src/agent/harness/demo-adapter";

describe("toHarnessPlanDraft", () => {
  it("maps a demo draft into Harness Plan without dispatching it", () => {
    const demo = createTaskPlanningDemo({
      domainHint: "QUALITY",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
    });

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
});
