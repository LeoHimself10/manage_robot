import { describe, expect, it, vi } from "vitest";
import {
  createTaskPlanningDemo,
  TaskPlanningDemoOptions,
} from "../../../src/agent/demo/pipeline";
import {
  qualityLlmResult,
  rdAmbiguousLlmResult,
  rdVvLlmResult,
} from "./llm-fixtures";

describe("createTaskPlanningDemo", () => {
  it("returns clarifying questions when input is too thin (does not call LLM)", async () => {
    const llmPlanner = vi.fn(async () => qualityLlmResult());
    const result = await createTaskPlanningDemo(
      {
        background: "某产品异常，尽快处理。",
        domainHint: "QUALITY",
      },
      { llmPlanner }
    );

    expect(result.status).toBe("NEEDS_MORE_INFO");
    if (result.status !== "NEEDS_MORE_INFO") throw new Error("expected NEEDS_MORE_INFO");
    expect(result.questions.length).toBeGreaterThan(0);
    expect(result.markdown).toBeUndefined();
    expect(llmPlanner).not.toHaveBeenCalled();
  });

  it("creates a markdown draft for sufficient quality input via LLM", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner: async () => qualityLlmResult() }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.classification.domain).toBe("QUALITY");
    expect(result.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
    expect(result.gate?.passed).toBe(true);
    expect(result.markdown).toContain("# 任务拆解 Demo 草案");
    expect(result.generation.trace?.requestId).toBe("test_trace");
  });

  it("preserves RD hints from LLM output", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "研发任务：B 设备启动失败，影响 3 台样机，已有实验记录和截图，需要本周完成初步整理。",
        domainHint: "RD",
      },
      { llmPlanner: async () => rdAmbiguousLlmResult() }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.classification.domain).toBe("RD");
    expect(result.markdown).not.toContain("## CAPA 建议");
    expect(result.tasks?.map((task) => task.title)).not.toContain("问题事实确认");
  });

  it("creates a markdown draft for RD V&V from LLM output", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "研发任务：制定 B 设备 V&V 验证方案，覆盖需求、风险、样本量、测试方法和通过准则，计划本周完成评审材料。",
        domainHint: "RD",
      },
      { llmPlanner: async () => rdVvLlmResult() }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.classification.domain).toBe("RD");
    expect(result.classification.subtype).toBe("VERIFICATION_AND_VALIDATION");
    expect(result.markdown).toContain("验证目标与范围确认");
    expect(result.markdown).not.toContain("## CAPA 建议");
  });

  it("returns the same open questions that are rendered in markdown", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner: async () => qualityLlmResult() }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.questions).toContain("是否存在重复发生？");
    expect(result.markdown).toContain("- 是否存在重复发生？");
  });

  it("uses llm result when provider returns a valid structured payload", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      {
        llmPlanner: async () => ({
          classification: {
            domain: "QUALITY",
            subtype: "PRODUCTION_PROCESS_ABNORMALITY",
            confidence: "HIGH",
            rationale: ["命中生产异常关键词"],
            missingInformation: [],
          },
          capaAdvisory: {
            advisory: "UNCERTAIN",
            rationale: ["仍需补充重复发生信息"],
            disclaimer:
              "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。",
            promptingQuestions: ["是否存在重复发生？"],
          },
          tasks: [
            {
              id: "task_1",
              title: "问题事实确认",
              objective: "确认问题事实",
              collaborators: [],
              inputMaterials: ["生产记录"],
              actions: ["收集证据"],
              deliverables: ["问题确认记录"],
              completionCriteria: ["事实明确"],
              timeNode: { checkpoints: ["完成事实确认"], dueAt: "T+1 工作日" },
              feedbackFrequency: "每日反馈",
              risksAndOpenQuestions: [],
              dependencyTaskIds: [],
            },
          ],
          openQuestions: ["是否存在重复发生？"],
          trace: {
            requestId: "trace_001",
            model: "qwen-plus",
            tokenUsage: { promptTokens: 120, completionTokens: 80, totalTokens: 200 },
            latencyMs: 1500,
          },
        }),
      }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.generation.trace?.requestId).toBe("trace_001");
  });

  it("fails when llm payload is invalid (no rule fallback)", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      {
        llmPlanner: async () => ({
          classification: {
            domain: "QUALITY",
            subtype: "PRODUCTION_PROCESS_ABNORMALITY",
            confidence: "HIGH",
            rationale: [],
            missingInformation: [],
          },
          tasks: [],
          openQuestions: [],
        }),
      }
    );

    expect(result.status).toBe("GENERATION_FAILED");
    if (result.status !== "GENERATION_FAILED") throw new Error("expected GENERATION_FAILED");
    expect(result.reason).toContain("tasks must contain at least one task");
    expect(result.recoverySuggestions.length).toBeGreaterThan(0);
    expect(result.markdown).toBeUndefined();
  });

  it("fails when llmPlanner is missing", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      {} as unknown as TaskPlanningDemoOptions
    );

    expect(result.status).toBe("GENERATION_FAILED");
    if (result.status !== "GENERATION_FAILED") throw new Error("expected GENERATION_FAILED");
    expect(result.reason).toContain("llmPlanner");
  });
});
