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

  it("preserves RD hints for ambiguous RD-oriented input", () => {
    const result = createTaskPlanningDemo({
      background:
        "研发任务：B 设备启动失败，影响 3 台样机，已有实验记录和截图，需要本周完成初步整理。",
      domainHint: "RD",
    });

    expect(result.status).toBe("DRAFT_READY");
    expect(result.classification?.domain).toBe("RD");
    expect(result.markdown).not.toContain("## CAPA 建议");
    expect(result.tasks?.map((task) => task.title)).not.toContain("问题事实确认");
  });

  it("returns the same open questions that are rendered in markdown", () => {
    const result = createTaskPlanningDemo({
      background:
        "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
      domainHint: "QUALITY",
    });

    expect(result.status).toBe("DRAFT_READY");
    expect(result.questions).toContain("是否存在重复发生？");
    expect(result.markdown).toContain("- 是否存在重复发生？");
  });
});
