import { describe, expect, it } from "vitest";
import { generateWbs } from "../../../src/agent/demo/wbs-generator";

describe("generateWbs", () => {
  it("creates quality issue task packages from classification", () => {
    const tasks = generateWbs({
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: ["生产异常"],
        missingInformation: [],
      },
      background:
        "生产测试发现 A 产品某批次开机自检失败率升高，已有生产记录和不良照片。",
    });

    expect(tasks.map((task) => task.title)).toContain("问题事实确认");
    expect(tasks.map((task) => task.title)).toContain("临时遏制与影响控制");
    expect(tasks.every((task) => task.deliverables.length > 0)).toBe(true);
  });

  it("creates R&D verification task packages", () => {
    const tasks = generateWbs({
      classification: {
        domain: "RD",
        subtype: "VERIFICATION_AND_VALIDATION",
        confidence: "HIGH",
        rationale: ["验证确认"],
        missingInformation: [],
      },
      background: "制定 V&V 验证方案，覆盖测试方法、样本量和通过准则。",
    });

    expect(tasks[0].title).toContain("验证目标");
    expect(tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("does not reuse mutable template arrays across calls", () => {
    const request = {
      classification: {
        domain: "QUALITY" as const,
        subtype: "PRODUCTION_PROCESS_ABNORMALITY" as const,
        confidence: "HIGH" as const,
        rationale: ["生产异常"],
        missingInformation: [],
      },
      background: "生产测试发现批次异常，需要生成任务包。",
    };

    const tasks = generateWbs(request);
    tasks[0].actions.push("污染动作");
    tasks[0].deliverables.push("污染交付物");
    tasks[0].completionCriteria.push("污染完成标准");
    tasks[0].timeNode.checkpoints.push("污染检查点");

    const freshTasks = generateWbs(request);

    expect(freshTasks[0].actions).not.toContain("污染动作");
    expect(freshTasks[0].deliverables).not.toContain("污染交付物");
    expect(freshTasks[0].completionCriteria).not.toContain("污染完成标准");
    expect(freshTasks[0].timeNode.checkpoints).not.toContain("污染检查点");
  });
});
