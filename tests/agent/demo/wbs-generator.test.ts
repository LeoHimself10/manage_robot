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
});
