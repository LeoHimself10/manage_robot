import { afterEach, describe, expect, it } from "vitest";
import { checkInputQuality } from "../../../src/agent/demo/input-qc";

describe("checkInputQuality", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("blocks empty input before calling the LLM", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background: "   ",
    });

    expect(result.canGenerateWbs).toBe(false);
    expect(result.missingFields).toEqual(["background"]);
    expect(result.questions.length).toBeGreaterThan(0);
  });

  it("lets non-empty quality input reach the LLM for semantic sufficiency judgment", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background: "某产品异常，影响10台，有照片，今天完成",
    });

    expect(result.canGenerateWbs).toBe(true);
    expect(result.missingFields).toEqual([]);
    expect(result.questions).toEqual([]);
  });

  it("does not use regex to block unknown critical context", () => {
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background: "生产测试发现 A 产品异常，影响范围待确认，已有照片，今天完成",
    });

    expect(result.canGenerateWbs).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it("blocks overly long background with INPUT_MAX_CHARS", () => {
    process.env.INPUT_MAX_CHARS = "20";
    const background = "a".repeat(30);
    const result = checkInputQuality({
      domainHint: "QUALITY",
      background,
    });
    expect(result.canGenerateWbs).toBe(false);
    expect(result.missingFields).toContain("background");
    expect(result.questions.some((q) => q.includes("分段") || q.includes("缩短"))).toBe(true);
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
