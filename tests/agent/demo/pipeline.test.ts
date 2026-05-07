import { describe, expect, it } from "vitest";
import { createTaskPlanningDemo } from "../../../src/agent/demo/pipeline";

describe("createTaskPlanningDemo", () => {
  it("returns clarifying questions when input is too thin", () => {
    const result = createTaskPlanningDemo({
      background: "某产品异常，尽快处理。",
      domainHint: "QUALITY",
    });

    expect(result.status).toBe("NEEDS_MORE_INFO");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.markdown).toBeUndefined();
  });

  it("creates a markdown draft for sufficient quality input", () => {
    const result = createTaskPlanningDemo({
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      domainHint: "QUALITY",
    });

    expect(result.status).toBe("DRAFT_READY");
    expect(result.classification?.domain).toBe("QUALITY");
    expect(result.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
    expect(result.gate?.passed).toBe(true);
    expect(result.markdown).toContain("# 任务拆解 Demo 草案");
  });
});
