import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_ORIGINAL_ASSESSMENT_V0_CATEGORY_DICTIONARY_VERSION,
  AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION,
} from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-context";
import { runAiOriginalAssessmentV0Batch } from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-batch";
import {
  buildAiOriginalAssessmentV0Messages,
  buildCompactAiCategoryTaxonomy,
} from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-prompt";
import {
  AiOriginalAssessmentV0RunError,
  prepareAiOriginalAssessmentV0,
  prepareAiOriginalAssessmentV0WithHistoricalRetrieval,
  runAiOriginalAssessmentV0,
} from "../../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import type { HistoricalFeedbackCaseRetriever } from
  "../../src/quality/ai-original-assessment/historical-feedback-case-retriever";
import {
  loadQwenAiOriginalAssessmentConfigFromEnv,
  QwenAiOriginalAssessmentModel,
  enrichAiOriginalAssessmentModelPayload,
  type AiOriginalAssessmentModelAdapter,
  type AiOriginalAssessmentModelRequest,
  type AiOriginalAssessmentModelResponse,
} from "../../src/quality/ai-original-assessment/qwen-ai-original-assessment-model";
import {
  buildValidAiSimulatedOutput,
  offlineModelResponse,
} from "./ai-original-assessment-test-fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

class OfflineAiModelAdapter implements AiOriginalAssessmentModelAdapter {
  readonly requests: AiOriginalAssessmentModelRequest[] = [];

  constructor(private readonly aiSimulatedPayload: unknown) {}

  async generate(
    request: AiOriginalAssessmentModelRequest,
  ): Promise<AiOriginalAssessmentModelResponse> {
    this.requests.push(request);
    return offlineModelResponse(this.aiSimulatedPayload);
  }
}

describe("AI原始研判V0本地输入准备", () => {
  it("只标准化反馈并提供分类字典和3条脱敏案例", () => {
    const prepared = prepareAiOriginalAssessmentV0();

    expect(prepared.normalizedFeedback.feedbackNo).toBe("FB-V0-DEMO-001");
    expect(prepared.normalizedFeedback.issueDescription).toContain("轴体中段出现明显弯折");
    expect(prepared).not.toHaveProperty("candidateDecision");
    expect(prepared.input).not.toHaveProperty("ruleHits");
    expect(prepared.input).not.toHaveProperty("riskRuleSet");
    expect(prepared.input).not.toHaveProperty("riskContext");
    expect(prepared.input.retrievedCases).toHaveLength(3);
    expect(prepared.input.categoryDictionary.version).toBe(
      AI_ORIGINAL_ASSESSMENT_V0_CATEGORY_DICTIONARY_VERSION,
    );
    expect(prepared.input.categoryDictionary.categories).toHaveLength(9);
    expect(prepared.input.categoryDictionary.categories.flatMap(
      (category) => category.secondaryCategories,
    )).toHaveLength(27);
    expect(prepared.input.runMetadata.promptVersion).toBe(
      AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION,
    );
  });

  it("正式字典明确区分轴体弯折和头端局部形态", () => {
    const dictionary = prepareAiOriginalAssessmentV0().input.categoryDictionary;
    const catheter = dictionary.categories.find(
      (category) => category.primaryCode === "CATHETER_PRODUCT",
    )!;
    const bend = catheter.secondaryCategories.find(
      (category) => category.secondaryCode === "CATHETER_BEND_SHAKE",
    )!;
    const passage = catheter.secondaryCategories.find(
      (category) => category.secondaryCode === "CATHETER_PASSAGE_SHAPE",
    )!;

    expect(bend.excludedScope.join("；")).toContain("头端");
    expect(passage.applicableScope.join("；")).toContain("出水口");
    expect(passage.excludedScope.join("；")).toContain("轴体");
  });

  it("Prompt让AI直接给风险建议，并明确人工最终审核", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const messages = buildAiOriginalAssessmentV0Messages({ assessmentInput: input });
    const serialized = JSON.stringify(messages);
    const compactTaxonomy = buildCompactAiCategoryTaxonomy(input.categoryDictionary);

    expect(serialized).toContain("风险等级只是AI建议，最终由人工审核");
    expect(serialized).toContain("术中或生产中");
    expect(serialized).toContain("建议HIGH");
    expect(serialized).toContain("建议MEDIUM");
    expect(serialized).toContain("handlingRecommendation是处理方式，不是分类编码");
    expect(serialized).toContain("严禁填写OTHER_GENERAL");
    expect(serialized).toContain("建议LOW");
    expect(serialized).toContain("impact和confirmation是可选字段");
    expect(serialized).toContain("OTHER_UNCLEAR/INSUFFICIENT_INFO");
    expect(serialized).toContain("最终由人工审核");
    expect(serialized).toContain("不得自动补写或伪造");
    expect(serialized).toContain(`FEEDBACK: ${input.sourceSnapshot.sourceKey}`);
    expect(serialized).toContain("HISTORICAL_CASE: CASE-TEST-001, CASE-TEST-002, CASE-TEST-003");
    expect(serialized).not.toContain("riskRuleSet");
    expect(serialized).not.toContain("riskContext");
    expect(serialized).not.toContain("ruleEvaluations");
    expect(serialized).not.toContain("riskFloor");
    expect(serialized).not.toContain("DATA_INCOMPLETE");
    expect(compactTaxonomy.split("\n")).toHaveLength(27);
    input.categoryDictionary.categories.forEach((primary) => {
      primary.secondaryCategories.forEach((secondary) => {
        expect(compactTaxonomy).toContain(
          `${primary.primaryCode}/${secondary.secondaryCode}`,
        );
      });
    });
    expect(serialized).not.toContain(input.runMetadata.requestId);
    expect(serialized).not.toContain(input.runMetadata.promptVersion);
    expect(serialized).not.toContain(input.sourceSnapshot.contentHash);
    expect(serialized).not.toContain("rowNumber");
    expect(serialized).not.toContain("sourceReference");
    expect(serialized).not.toContain("typicalExpressions");
    expect(serialized).not.toContain("additionalProperties");
    expect(messages.reduce((total, message) => total + message.content.length, 0))
      .toBeLessThan(14_000);
  });

  it("只纠正OTHER_UNCLEAR下可唯一确定的处理方式枚举", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const base = buildValidAiSimulatedOutput(input);
    const ordinary = enrichAiOriginalAssessmentModelPayload(input, {
      ...base,
      handlingRecommendation: "OTHER_GENERAL",
      primaryCategoryCode: "OTHER_UNCLEAR",
      secondaryCategoryCode: "OTHER_GENERAL",
    }) as Record<string, unknown>;
    const needsInfo = enrichAiOriginalAssessmentModelPayload(input, {
      ...base,
      handlingRecommendation: "INSUFFICIENT_INFO",
      primaryCategoryCode: "OTHER_UNCLEAR",
      secondaryCategoryCode: "INSUFFICIENT_INFO",
    }) as Record<string, unknown>;
    const stillInvalid = enrichAiOriginalAssessmentModelPayload(input, {
      ...base,
      handlingRecommendation: "OTHER_GENERAL",
      primaryCategoryCode: "CATHETER_PRODUCT",
      secondaryCategoryCode: "CATHETER_BEND_SHAKE",
    }) as Record<string, unknown>;

    expect(ordinary.handlingRecommendation).toBe("ORDINARY");
    expect(needsInfo.handlingRecommendation).toBe("NEEDS_INFO");
    expect(stillInvalid.handlingRecommendation).toBe("OTHER_GENERAL");
  });

  it("正式准备路径在标准化后检索，并把实际案例传给模型输入", async () => {
    const demo = prepareAiOriginalAssessmentV0();
    const actualRetrievedCase = demo.input.retrievedCases[1]!;
    const caseRetriever: HistoricalFeedbackCaseRetriever = {
      version: "TEST-LOCAL-INDEX-V0",
      retrieve(normalizedFeedback) {
        expect(normalizedFeedback).toBe(demo.normalizedFeedback);
        return [actualRetrievedCase];
      },
    };
    const prepared = prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
      normalizedFeedback: demo.normalizedFeedback,
      requestId: "REQ-LOCAL-RETRIEVAL-TEST",
      caseRetriever,
    });
    const adapter = new OfflineAiModelAdapter(buildValidAiSimulatedOutput(prepared.input));

    await runAiOriginalAssessmentV0({ model: adapter, prepared });

    expect(prepared.input.retrievedCases).toEqual([actualRetrievedCase]);
    expect(prepared.input.runMetadata.caseLibraryVersion).toBe("TEST-LOCAL-INDEX-V0");
    expect(adapter.requests[0]!.input.retrievedCases).toEqual([actualRetrievedCase]);
    expect(adapter.requests[0]!.input.retrievedCases).not.toEqual(
      demo.input.retrievedCases,
    );
  });

  it("没有达到阈值的案例时不回退演示案例", () => {
    const demo = prepareAiOriginalAssessmentV0();
    const prepared = prepareAiOriginalAssessmentV0WithHistoricalRetrieval({
      normalizedFeedback: demo.normalizedFeedback,
      requestId: "REQ-NO-SIMILAR-CASE",
      caseRetriever: { version: "TEST-EMPTY-INDEX", retrieve: () => [] },
    });
    const serializedPrompt = JSON.stringify(buildAiOriginalAssessmentV0Messages({
      assessmentInput: prepared.input,
    }));

    expect(prepared.input.retrievedCases).toEqual([]);
    expect(serializedPrompt).toContain("HISTORICAL_CASE: 无");
    expect(serializedPrompt).toContain("similarCases必须返回空数组");
    expect(serializedPrompt).not.toContain("CASE-TEST-001");
  });
});

describe("AI原始研判V0单次业务调用", () => {
  it("离线假模型只返回一次完整AI建议，校验通过", async () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const aiSimulatedOutput = buildValidAiSimulatedOutput(prepared.input);
    const adapter = new OfflineAiModelAdapter(aiSimulatedOutput);

    const result = await runAiOriginalAssessmentV0({ model: adapter, prepared });

    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]).toEqual({ input: prepared.input });
    expect(result.attempts).toBe(1);
    expect(result.validation).toMatchObject({ ok: true });
    expect(result.output).toEqual(aiSimulatedOutput);
  });

  it("AI业务输出不合格时明确失败且不重新调用模型", async () => {
    const adapter = new OfflineAiModelAdapter({ not: "the required output" });

    try {
      await runAiOriginalAssessmentV0({ model: adapter });
      throw new Error("expected model output validation failure");
    } catch (error) {
      expect(error).toMatchObject({
        name: "AiOriginalAssessmentV0RunError",
        code: "MODEL_OUTPUT_INVALID",
        attempts: 1,
      } satisfies Partial<AiOriginalAssessmentV0RunError>);
      expect(error).toBeInstanceOf(AiOriginalAssessmentV0RunError);
      expect((error as AiOriginalAssessmentV0RunError).validationIssues.map(
        (issue) => issue.code,
      )).toContain("OUTPUT_SCHEMA_INVALID");
    }
    expect(adapter.requests).toHaveLength(1);
  });
});

describe("AI原始研判V0批量隔离", () => {
  it("单条失败不会中断整个批次", async () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const validOutput = buildValidAiSimulatedOutput(prepared.input);
    const payloads = [{ invalid: true }, validOutput];
    const adapter: AiOriginalAssessmentModelAdapter = {
      async generate() {
        return offlineModelResponse(payloads.shift());
      },
    };

    const result = await runAiOriginalAssessmentV0Batch({
      model: adapter,
      items: [
        { batchItemId: "BATCH-FAIL", prepared },
        { batchItemId: "BATCH-PASS", prepared },
      ],
    });

    expect(result).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.items[0]).toMatchObject({
      batchItemId: "BATCH-FAIL",
      ok: false,
      error: { code: "MODEL_OUTPUT_INVALID" },
    });
    expect(result.items[1]).toMatchObject({ batchItemId: "BATCH-PASS", ok: true });
  });
});

describe("Qwen/DashScope兼容无工具模型适配器", () => {
  it("没有环境变量密钥时不创建配置", () => {
    expect(loadQwenAiOriginalAssessmentConfigFromEnv({})).toBeUndefined();
  });

  it("离线模拟网络响应时只发起一次无工具请求", async () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(prepared.input);
    const compactModelOutput: Record<string, unknown> = structuredClone(output);
    delete compactModelOutput.schemaVersion;
    delete compactModelOutput.requestId;
    delete compactModelOutput.provenance;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "offline-qwen-request",
        model: "qwen-offline-test",
        choices: [{ message: { content: JSON.stringify(compactModelOutput) } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const offlineCredentialPlaceholder = ["offline", "credential", "placeholder"].join("-");
    const config = loadQwenAiOriginalAssessmentConfigFromEnv({
      DASHSCOPE_API_KEY: offlineCredentialPlaceholder,
      QWEN_MODEL: "qwen-offline-test",
    });
    expect(config).toBeDefined();

    const result = await runAiOriginalAssessmentV0({
      model: new QwenAiOriginalAssessmentModel(config!),
      prepared,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body.tools).toEqual([]);
    expect(body).not.toHaveProperty("tool_choice");
    expect(body).not.toHaveProperty("response_format");
    expect(String(request.body)).not.toContain(offlineCredentialPlaceholder);
    expect(JSON.stringify(body.messages)).not.toContain(AI_ORIGINAL_ASSESSMENT_V0_PROMPT_VERSION);
    expect(JSON.stringify(body.messages)).toContain("风险等级只是AI建议");
    expect(JSON.stringify(body.messages)).not.toContain("ruleEvaluations");
    expect(result.modelResponse.toolCallsExecuted).toBe(0);
    expect(result.validation).toMatchObject({ ok: true });
    expect(result.output).toEqual(output);
  });

  it("模型返回非JSON时不进行第二次业务研判", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "offline-invalid-json",
        model: "qwen-offline-test",
        choices: [{ message: { content: "这不是JSON" } }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const config = loadQwenAiOriginalAssessmentConfigFromEnv({
      QWEN_API_KEY: ["offline", "credential", "placeholder"].join("-"),
      QWEN_MODEL: "qwen-offline-test",
    });

    await expect(runAiOriginalAssessmentV0({
      model: new QwenAiOriginalAssessmentModel(config!),
    })).rejects.toMatchObject({
      code: "MODEL_OUTPUT_INVALID",
      attempts: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
