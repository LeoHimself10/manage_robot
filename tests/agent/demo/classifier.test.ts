import { describe, expect, it } from "vitest";
import { classifyTask } from "../../../src/agent/demo/classifier";

describe("classifyTask", () => {
  it("classifies production process quality issues", () => {
    const result = classifyTask({
      background: "生产测试发现 A 产品某批次开机自检失败率升高，已有生产记录。",
    });

    expect(result.domain).toBe("QUALITY");
    expect(result.subtype).toBe("PRODUCTION_PROCESS_ABNORMALITY");
    expect(result.confidence).toBe("HIGH");
  });

  it("classifies verification and validation R&D tasks", () => {
    const result = classifyTask({
      background: "需要制定 V&V 验证方案，覆盖需求、样本量、测试方法和通过准则。",
    });

    expect(result.domain).toBe("RD");
    expect(result.subtype).toBe("VERIFICATION_AND_VALIDATION");
  });

  it("marks thin ambiguous input as uncertain", () => {
    const result = classifyTask({ background: "这个事情需要处理一下。" });

    expect(result.confidence).toBe("LOW");
    expect(result.missingInformation.length).toBeGreaterThan(0);
  });
});
