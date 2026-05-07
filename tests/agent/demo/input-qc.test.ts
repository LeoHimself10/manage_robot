import { describe, expect, it } from "vitest";
import { checkInputQuality } from "../../../src/agent/demo/input-qc";

describe("checkInputQuality", () => {
  it("blocks WBS generation when quality context is too thin", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background: "某产品异常，尽快分析原因。",
    });

    expect(result.canGenerateWbs).toBe(false);
    expect(result.missingFields).toContain("problemSource");
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("allows WBS generation when quality context contains key facts", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
    });

    expect(result.canGenerateWbs).toBe(true);
    expect(result.missingFields).not.toContain("problemPhenomenon");
  });
});
