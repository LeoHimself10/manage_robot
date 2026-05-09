import { describe, expect, it, vi } from "vitest";
import {
  createTaskPlanningDemo,
  TaskPlanningDemoOptions,
} from "../../../src/agent/demo/pipeline";
import {
  minimalQualityTask,
  qualityLlmPlannerResponse,
  qualityLlmResult,
  rdAmbiguousLlmPlannerResponse,
  rdVvLlmPlannerResponse,
} from "./llm-fixtures";
import { CAPA_DISCLAIMER } from "../../../src/domain/capa";

describe("createTaskPlanningDemo", () => {
  it("returns clarificationUx NON_TASK when LLM marks greeting path", async () => {
    const llmPlanner = vi.fn(async () =>
      qualityLlmPlannerResponse({
        responseIntent: "CHAT",
        assistantMessage: "我是任务规划 Demo 机器人，可直接发场景与背景描述。",
        clarificationUx: "NON_TASK",
        classification: {
          domain: "QUALITY",
          subtype: "QUALITY_OTHER_OR_UNCERTAIN",
          confidence: "LOW",
          rationale: ["输入非任务描述"],
          missingInformation: [],
        },
        tasks: [],
        openQuestions: ["我是任务规划 Demo 机器人，可直接发场景与背景描述。"],
        capaAdvisory: {
          advisory: "INSUFFICIENT_INFO",
          rationale: ["无质量任务要素"],
          disclaimer: CAPA_DISCLAIMER,
          promptingQuestions: [],
        },
      })
    );
    const result = await createTaskPlanningDemo(
      { background: "hi", domainHint: "QUALITY" },
      { llmPlanner }
    );
    expect(result.status).toBe("CONVERSATION");
    if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
    expect(result.responseIntent).toBe("CHAT");
    expect(result.clarificationUx).toBe("NON_TASK");
    expect(result.questions).toEqual(["我是任务规划 Demo 机器人，可直接发场景与背景描述。"]);
  });

  it("returns CHAT without markdown table for conversational output", async () => {
    const result = await createTaskPlanningDemo(
      { background: "你好", domainHint: "QUALITY" },
      {
        llmPlanner: async () =>
          qualityLlmPlannerResponse({
            responseIntent: "CHAT",
            assistantMessage: "你好，我可以帮你把质量或研发任务拆成可承接的任务包。",
            clarificationUx: "NON_TASK",
            classification: {
              domain: "QUALITY",
              subtype: "QUALITY_OTHER_OR_UNCERTAIN",
              confidence: "LOW",
              rationale: ["寒暄"],
              missingInformation: [],
            },
            tasks: [],
            openQuestions: [],
            capaAdvisory: {
              advisory: "INSUFFICIENT_INFO",
              rationale: ["非任务"],
              disclaimer: CAPA_DISCLAIMER,
              promptingQuestions: [],
            },
            gateSelfCheck: { passed: true, missingByTask: [] },
          }),
      }
    );

    expect(result.status).toBe("CONVERSATION");
    if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
    expect(result.responseIntent).toBe("CHAT");
    expect(result.assistantMessage).toContain("质量或研发任务");
    expect(result.markdown).toBeUndefined();
  });

  it("returns RESET_OR_NEW_TASK without carrying a task table", async () => {
    const result = await createTaskPlanningDemo(
      { background: "咱们开始一个新任务吧", domainHint: "QUALITY", sessionDigest: "上一轮任务包：旧任务" },
      {
        llmPlanner: async () =>
          qualityLlmPlannerResponse({
            responseIntent: "RESET_OR_NEW_TASK",
            assistantMessage: "好的，我们从新任务开始。请直接告诉我新任务的背景、目标和时间要求。",
            clarificationUx: "NON_TASK",
            classification: {
              domain: "QUALITY",
              subtype: "QUALITY_OTHER_OR_UNCERTAIN",
              confidence: "LOW",
              rationale: ["用户明确要求开始新任务"],
              missingInformation: [],
            },
            tasks: [],
            openQuestions: [],
            capaAdvisory: {
              advisory: "INSUFFICIENT_INFO",
              rationale: ["等待新任务背景"],
              disclaimer: CAPA_DISCLAIMER,
              promptingQuestions: [],
            },
            gateSelfCheck: { passed: true, missingByTask: [] },
          }),
      }
    );

    expect(result.status).toBe("CONVERSATION");
    if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
    expect(result.responseIntent).toBe("RESET_OR_NEW_TASK");
    expect(result.assistantMessage).toContain("新任务");
    expect(result.markdown).toBeUndefined();
  });

  it("returns clarifying questions from LLM when input is too thin", async () => {
    const llmPlanner = vi.fn(async () =>
      qualityLlmPlannerResponse({
        responseIntent: "CLARIFY",
        assistantMessage: "还需要补充问题来源和影响范围后才能形成任务包。",
        classification: {
          domain: "QUALITY",
          subtype: "QUALITY_OTHER_OR_UNCERTAIN",
          confidence: "LOW",
          rationale: ["信息不足，无法形成可承接任务包"],
          missingInformation: ["问题来源", "影响范围"],
        },
        tasks: [],
        openQuestions: ["问题来源是什么？", "影响范围是什么？"],
      })
    );
    const result = await createTaskPlanningDemo(
      {
        background: "某产品异常，尽快处理。",
        domainHint: "QUALITY",
      },
      { llmPlanner }
    );

    expect(result.status).toBe("CONVERSATION");
    if (result.status !== "CONVERSATION") throw new Error("expected CONVERSATION");
    expect(result.responseIntent).toBe("CLARIFY");
    expect(result.questions).toEqual(["问题来源是什么？", "影响范围是什么？"]);
    expect(result.missingFields).toEqual(["问题来源", "影响范围"]);
    expect(result.markdown).toBeUndefined();
    expect(llmPlanner).toHaveBeenCalledTimes(1);
  });

  it("rejects draft intent with low confidence when tasks are empty", async () => {
    const result = await createTaskPlanningDemo(
      {
        background: "某产品异常，尽快处理。",
        domainHint: "QUALITY",
      },
      {
        enableLlmCorrection: false,
        llmPlanner: async () =>
          qualityLlmPlannerResponse({
            responseIntent: "DRAFT",
            assistantMessage: "当前信息不足，但尝试生成草案。",
            classification: {
              domain: "QUALITY",
              subtype: "QUALITY_OTHER_OR_UNCERTAIN",
              confidence: "LOW",
              rationale: ["信息不足"],
              missingInformation: ["问题来源"],
            },
            tasks: [],
            openQuestions: ["x"],
            capaAdvisory: {
              advisory: "INSUFFICIENT_INFO",
              rationale: ["信息不足"],
              disclaimer: CAPA_DISCLAIMER,
              promptingQuestions: [],
            },
            gateSelfCheck: { passed: true, missingByTask: [] },
          }),
      }
    );

    expect(result.status).toBe("GENERATION_FAILED");
    if (result.status !== "GENERATION_FAILED") throw new Error("expected GENERATION_FAILED");
    expect(result.reason).toContain("tasks must contain at least one task");
  });

  it("rejects omitted intent with high confidence when tasks are empty", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      {
        enableLlmCorrection: false,
        llmPlanner: async () => ({
          rawJson: {
            classification: {
              domain: "QUALITY",
              subtype: "PRODUCTION_PROCESS_ABNORMALITY",
              confidence: "HIGH",
              rationale: ["生产异常"],
              missingInformation: [],
            },
            capaAdvisory: {
              advisory: "UNCERTAIN",
              rationale: ["需进一步确认"],
              disclaimer: CAPA_DISCLAIMER,
              promptingQuestions: [],
            },
            tasks: [],
            openQuestions: [],
            gateSelfCheck: { passed: true, missingByTask: [] },
          },
          trace: {
            requestId: "omitted_intent_empty_tasks",
            model: "qwen-plus",
            tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            latencyMs: 1,
          },
        }),
      }
    );

    expect(result.status).toBe("GENERATION_FAILED");
    if (result.status !== "GENERATION_FAILED") throw new Error("expected GENERATION_FAILED");
    expect(result.reason).toContain("tasks must contain at least one task");
  });

  it("creates a markdown draft for sufficient quality input via LLM", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner: async () => qualityLlmPlannerResponse() }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.classification.domain).toBe("QUALITY");
    expect(result.capaAdvisory?.disclaimer).toContain("最终是否开启 CAPA");
    expect(result.gate?.passed).toBe(true);
    expect(result.markdown).toContain("# 任务拆解草案");
    expect(result.markdown).not.toContain("## 派发门禁");
    expect(result.markdown).not.toContain("状态：通过");
    expect(result.generation.trace?.requestId).toBe("test_trace");
    expect(result.generation.correctionUsed).toBe(false);
    expect(result.generation.traces).toHaveLength(1);
    expect(result.generation.timings?.plannerMs).toBeGreaterThanOrEqual(0);
    expect(result.generation.timings?.coerceMs).toBeGreaterThanOrEqual(0);
    expect(result.generation.timings?.validateMs).toBeGreaterThanOrEqual(0);
    expect(result.generation.timings?.gateMs).toBeGreaterThanOrEqual(0);
    expect(result.generation.timings?.renderMs).toBeGreaterThanOrEqual(0);
  });

  it("forwards sessionDigest to llmPlanner", async () => {
    const llmPlanner = vi.fn(async () => qualityLlmPlannerResponse());
    await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
        sessionDigest: "prior digest line",
      },
      { llmPlanner }
    );
    expect(llmPlanner).toHaveBeenCalledTimes(1);
    expect(llmPlanner).toHaveBeenCalledWith(
      expect.objectContaining({ sessionDigest: "prior digest line" }),
    );
  });

  it("emits structured log on DRAFT_READY", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner: async () => qualityLlmPlannerResponse() }
    );
    expect(result.status).toBe("DRAFT_READY");
    const jsonLine = logSpy.mock.calls.map((c) => c[0]).find((s) => String(s).includes('"event":"demo_draft_ready"'));
    expect(jsonLine).toBeDefined();
    const row = JSON.parse(String(jsonLine)) as {
      event: string;
      traceId: string;
      wallClockMs: number;
      timings: Record<string, number>;
    };
    expect(row.event).toBe("demo_draft_ready");
    expect(row.traceId).toBeTruthy();
    expect(row.wallClockMs).toBeGreaterThanOrEqual(0);
    expect(row.timings.renderMs).toBeGreaterThanOrEqual(0);
    logSpy.mockRestore();
  });

  it("records two traces when correction pass succeeds", async () => {
    let n = 0;
    const llmPlanner = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        return qualityLlmPlannerResponse({
          classification: {
            domain: "QUALITY",
            subtype: "PRODUCTION_PROCESS_ABNORMALITY",
            confidence: "HIGH",
            rationale: [],
            missingInformation: [],
          },
          tasks: [],
          openQuestions: [],
        });
      }
      return qualityLlmPlannerResponse();
    });
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner }
    );
    expect(llmPlanner).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.generation.traces).toHaveLength(2);
    expect(result.generation.correctionUsed).toBe(true);
  });

  it("preserves RD hints from LLM output", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "研发任务：B 设备启动失败，影响 3 台样机，已有实验记录和截图，需要本周完成初步整理。",
        domainHint: "RD",
      },
      { llmPlanner: async () => rdAmbiguousLlmPlannerResponse() }
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
      { llmPlanner: async () => rdVvLlmPlannerResponse() }
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
      { llmPlanner: async () => qualityLlmPlannerResponse() }
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
          rawJson: {
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
          },
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

  it("fails when llm payload is invalid and retries once with correction by default", async () => {
    const invalidRaw = {
      responseIntent: "DRAFT",
      assistantMessage: "已根据当前信息生成任务拆解草案。",
      classification: {
        domain: "QUALITY",
        subtype: "PRODUCTION_PROCESS_ABNORMALITY",
        confidence: "HIGH",
        rationale: [],
        missingInformation: [],
      },
      capaAdvisory: qualityLlmResult().capaAdvisory,
      tasks: [],
      openQuestions: [],
    };
    const llmPlanner = vi.fn(async () => ({
      rawJson: invalidRaw,
      trace: {
        requestId: "first_try",
        model: "qwen-plus",
        tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latencyMs: 1,
      },
    }));

    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner }
    );

    expect(llmPlanner).toHaveBeenCalledTimes(2);
    expect(llmPlanner).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        correction: expect.objectContaining({
          validationErrors: expect.arrayContaining(["tasks must contain at least one task"]),
        }),
      })
    );

    expect(result.status).toBe("GENERATION_FAILED");
    if (result.status !== "GENERATION_FAILED") throw new Error("expected GENERATION_FAILED");
    expect(result.reason).toContain("tasks must contain at least one task");
    expect(result.recoverySuggestions.length).toBeGreaterThan(0);
    expect(result.markdown).toBeUndefined();
  });

  it("skips correction when enableLlmCorrection is false", async () => {
    const llmPlanner = vi.fn(async () => ({
      rawJson: {
        responseIntent: "DRAFT",
        assistantMessage: "已根据当前信息生成任务拆解草案。",
        classification: {
          domain: "QUALITY",
          subtype: "PRODUCTION_PROCESS_ABNORMALITY",
          confidence: "HIGH",
          rationale: [],
          missingInformation: [],
        },
        capaAdvisory: qualityLlmResult().capaAdvisory,
        tasks: [],
        openQuestions: [],
      },
      trace: {
        requestId: "once",
        model: "qwen-plus",
        tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        latencyMs: 1,
      },
    }));

    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      { llmPlanner, enableLlmCorrection: false }
    );

    expect(llmPlanner).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("GENERATION_FAILED");
  });

  it("keeps LLM drafts with missing gate fields visible as blocked drafts", async () => {
    const result = await createTaskPlanningDemo(
      {
        background:
          "生产测试发现 A 产品 2026-05-01 批次开机自检失败率升高，目前影响 20 台，已有测试记录和不良照片，要求两天内完成初步分析。",
        domainHint: "QUALITY",
      },
      {
        llmPlanner: async () =>
          qualityLlmPlannerResponse({
            tasks: [
              minimalQualityTask({
                deliverables: [],
                completionCriteria: [],
                timeNode: { checkpoints: [], dueAt: "" },
                feedbackFrequency: "",
              }),
            ],
            gateSelfCheck: {
              passed: false,
              missingByTask: [
                {
                  taskId: "task_1",
                  title: "问题事实确认",
                  missingFields: [
                    "deliverables",
                    "completionCriteria",
                    "timeNode.dueAt",
                    "feedbackFrequency",
                  ],
                },
              ],
            },
          }),
      }
    );

    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected DRAFT_READY");
    expect(result.gate.passed).toBe(false);
    expect(result.gate.missingByTask[0].missingFields).toEqual([
      "deliverables",
      "completionCriteria",
      "timeNode.dueAt",
      "feedbackFrequency",
    ]);
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

  it("DRAFT_READY includes traceId for downstream assignment", async () => {
    const result = await createTaskPlanningDemo(
      { background: "生产批次异常，需两天内初步分析", domainHint: "QUALITY" },
      { llmPlanner: async () => qualityLlmPlannerResponse({}) }
    );
    expect(result.status).toBe("DRAFT_READY");
    if (result.status !== "DRAFT_READY") throw new Error("expected draft");
    expect(result.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });
});
