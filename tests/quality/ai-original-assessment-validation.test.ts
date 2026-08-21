import { describe, expect, it } from "vitest";
import {
  aiOriginalAssessmentInputSchema,
  aiOriginalAssessmentOutputSchema,
  type AiOriginalAssessmentInput,
} from "../../src/quality/ai-original-assessment/ai-original-assessment-contracts";
import { prepareAiOriginalAssessmentV0 } from
  "../../src/quality/ai-original-assessment/ai-original-assessment-v0-runner";
import { canSetSourceStatusReported } from
  "../../src/quality/ai-original-assessment/reported-source-status-policy";
import {
  validateAiOriginalAssessment,
  type AiOriginalAssessmentValidationIssueCode,
} from "../../src/quality/ai-original-assessment/validate-ai-original-assessment";
import { buildValidAiSimulatedOutput } from "./ai-original-assessment-test-fixtures";

function expectIssueCode(
  input: unknown,
  output: unknown,
  code: AiOriginalAssessmentValidationIssueCode,
): void {
  const result = validateAiOriginalAssessment(input, output);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.issues.map((issue) => issue.code)).toContain(code);
}

describe("AI原始研判V0数据合同", () => {
  it("完整输入和输出通过Schema及跨字段校验", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);

    expect(aiOriginalAssessmentInputSchema.safeParse(input).success).toBe(true);
    expect(aiOriginalAssessmentOutputSchema.safeParse(output).success).toBe(true);
    expect(validateAiOriginalAssessment(input, output)).toMatchObject({ ok: true });
    expect(input.categoryDictionary.categories.every(
      (category) => category.primaryDefinition.trim().length > 0
        && category.secondaryCategories.every(
          (secondary) => secondary.definition.trim().length > 0
            && secondary.applicableScope.length > 0
            && secondary.excludedScope.length > 0
            && secondary.typicalExpressions.length > 0,
        ),
    )).toBe(true);
  });

  it("retrievedCases允许0到3条，且真实案例可以没有历史风险字段", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const baseCase = input.retrievedCases[0]!;
    const { riskLevel: _riskLevel, ...caseWithoutRisk } = baseCase;
    const cases = Array.from({ length: 4 }, (_, index) => ({
      ...caseWithoutRisk,
      caseId: `CASE-RANGE-${index + 1}`,
    }));

    for (let count = 0; count <= 3; count += 1) {
      expect(aiOriginalAssessmentInputSchema.safeParse({
        ...input,
        retrievedCases: cases.slice(0, count),
      }).success).toBe(true);
    }
    expect(aiOriginalAssessmentInputSchema.safeParse({
      ...input,
      retrievedCases: cases,
    }).success).toBe(false);
  });

  it("没有检索案例时，输出不能引用或声明历史案例", () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const input: AiOriginalAssessmentInput = {
      ...prepared.input,
      retrievedCases: [],
    };
    const output = buildValidAiSimulatedOutput(input);
    expect(validateAiOriginalAssessment(input, output)).toMatchObject({ ok: true });
    expectIssueCode(input, {
      ...output,
      similarCases: [{ caseId: "CASE-TEST-001", similarityReason: "未实际检索" }],
    }, "SIMILAR_CASE_NOT_IN_INPUT");
    expectIssueCode(input, {
      ...output,
      citations: [...output.citations, {
        citationId: "CIT-NOT-RETRIEVED",
        sourceType: "HISTORICAL_CASE",
        sourceId: "CASE-TEST-001",
        description: "未实际检索的案例",
      }],
    }, "CITATION_SOURCE_NOT_IN_INPUT");
  });

  it("impact和confirmation允许为空、null或缺失", () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const baseSnapshot = prepared.input.sourceSnapshot;
    const { impact: _impact, confirmation: _confirmation, ...withoutOptionalFields } = baseSnapshot;
    const inputs: AiOriginalAssessmentInput[] = [
      {
        ...prepared.input,
        sourceSnapshot: { ...baseSnapshot, impact: "", confirmation: "" },
      },
      {
        ...prepared.input,
        sourceSnapshot: { ...baseSnapshot, impact: null, confirmation: null },
      },
      {
        ...prepared.input,
        sourceSnapshot: withoutOptionalFields,
      },
    ];

    inputs.forEach((input) => {
      expect(aiOriginalAssessmentInputSchema.safeParse(input).success).toBe(true);
      expect(validateAiOriginalAssessment(input, buildValidAiSimulatedOutput(input))).toMatchObject({
        ok: true,
      });
    });
  });

  it("可选资料缺失时AI仍可列入信息缺口，但不强制待补资料", () => {
    const prepared = prepareAiOriginalAssessmentV0();
    const input: AiOriginalAssessmentInput = {
      ...prepared.input,
      sourceSnapshot: { ...prepared.input.sourceSnapshot, impact: null, confirmation: null },
    };
    const output = buildValidAiSimulatedOutput(input);
    output.handlingRecommendation = "QUALITY_ANOMALY";
    output.missingInformation = [
      { field: "impact", reason: "建议人工补充实际影响。" },
      { field: "confirmation", reason: "建议人工补充检查确认情况。" },
    ];

    expect(validateAiOriginalAssessment(input, output)).toMatchObject({ ok: true });
  });

  it("缺少合同必填结构时校验失败", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const { categoryDictionary: _removed, ...missingInputField } = input;
    const output = buildValidAiSimulatedOutput(input);
    const { reasoningBasis: _removedOutput, ...missingOutputField } = output;

    expectIssueCode(missingInputField, output, "INPUT_SCHEMA_INVALID");
    expectIssueCode(input, missingOutputField, "OUTPUT_SCHEMA_INVALID");
  });

  it("拒绝允许列表以外的处理建议和风险等级", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);

    expectIssueCode(
      input,
      { ...output, handlingRecommendation: "AUTO_REPORTED" },
      "OUTPUT_SCHEMA_INVALID",
    );
    expectIssueCode(input, { ...output, riskLevel: "CRITICAL" }, "OUTPUT_SCHEMA_INVALID");
  });

  it("风险LOW、MEDIUM、HIGH均由AI直接建议，程序不设风险下限", () => {
    const { input } = prepareAiOriginalAssessmentV0();

    for (const riskLevel of ["LOW", "MEDIUM", "HIGH"] as const) {
      const output = { ...buildValidAiSimulatedOutput(input), riskLevel };
      expect(validateAiOriginalAssessment(input, output)).toMatchObject({ ok: true });
    }
  });

  it("拒绝不在分类字典中的分类组合", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);
    expectIssueCode(
      input,
      { ...output, secondaryCategoryCode: "NOT_A_REAL_CATEGORY" },
      "CATEGORY_NOT_IN_DICTIONARY",
    );
  });

  it("拒绝真实编码之间错误的一级和二级父子组合", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);
    expectIssueCode(
      input,
      {
        ...output,
        primaryCategoryCode: "CATHETER_PRODUCT",
        secondaryCategoryCode: "IMAGE_DARK",
      },
      "CATEGORY_NOT_IN_DICTIONARY",
    );
  });

  it("NEEDS_INFO必须且只能与信息不足分类同时出现", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);
    expectIssueCode(
      input,
      { ...output, handlingRecommendation: "NEEDS_INFO" },
      "HANDLING_CATEGORY_MISMATCH",
    );
    expectIssueCode(
      input,
      {
        ...output,
        primaryCategoryCode: "OTHER_UNCLEAR",
        secondaryCategoryCode: "INSUFFICIENT_INFO",
      },
      "HANDLING_CATEGORY_MISMATCH",
    );
  });

  it("分类字典拒绝全局重复的二级编码或名称", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const duplicateCode = structuredClone(input.categoryDictionary);
    duplicateCode.categories[1]!.secondaryCategories[0]!.secondaryCode =
      duplicateCode.categories[0]!.secondaryCategories[0]!.secondaryCode;
    expect(aiOriginalAssessmentInputSchema.safeParse({
      ...input,
      categoryDictionary: duplicateCode,
    }).success).toBe(false);

    const duplicateLabel = structuredClone(input.categoryDictionary);
    duplicateLabel.categories[1]!.secondaryCategories[0]!.secondaryLabel =
      duplicateLabel.categories[0]!.secondaryCategories[0]!.secondaryLabel;
    expect(aiOriginalAssessmentInputSchema.safeParse({
      ...input,
      categoryDictionary: duplicateLabel,
    }).success).toBe(false);
  });

  it("拒绝本次未提供的相似案例和引用来源", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);
    expectIssueCode(
      input,
      { ...output, similarCases: [{ caseId: "CASE-NOT-PROVIDED", similarityReason: "不存在" }] },
      "SIMILAR_CASE_NOT_IN_INPUT",
    );
    expectIssueCode(
      input,
      {
        ...output,
        citations: output.citations.map((citation) => citation.sourceType === "HISTORICAL_CASE"
          ? { ...citation, sourceId: "CASE-NOT-PROVIDED" }
          : citation),
      },
      "CITATION_SOURCE_NOT_IN_INPUT",
    );
  });

  it("风险上下文和规则定义不再是合法引用来源", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);

    expectIssueCode(input, {
      ...output,
      citations: [{
        citationId: "CIT-REMOVED-RISK",
        sourceType: "RISK_CONTEXT",
        sourceId: "sameBatchSimilarCount30d",
        description: "已经移除的来源类型。",
      }],
    }, "OUTPUT_SCHEMA_INVALID");
    expectIssueCode(input, {
      ...output,
      citations: [{
        citationId: "CIT-REMOVED-RULE",
        sourceType: "DETERMINISTIC_RULE",
        sourceId: "HIGH_RISK_KEYWORD",
        description: "已经移除的来源类型。",
      }],
    }, "OUTPUT_SCHEMA_INVALID");
  });

  it("拒绝未声明的判断依据引用和不一致的版本", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);
    expectIssueCode(
      input,
      { ...output, reasoningBasis: [{ statement: "错误引用", citationIds: ["UNKNOWN"] }] },
      "REASONING_CITATION_NOT_DECLARED",
    );
    expectIssueCode(
      input,
      { ...output, provenance: { ...output.provenance, promptVersion: "wrong-version" } },
      "PROVENANCE_MISMATCH",
    );
  });

  it("旧的规则判断、风险下限和业务状态字段都会被拒绝", () => {
    const { input } = prepareAiOriginalAssessmentV0();
    const output = buildValidAiSimulatedOutput(input);

    expectIssueCode(input, { ...output, ruleEvaluations: [] }, "OUTPUT_SCHEMA_INVALID");
    expectIssueCode(input, { ...output, riskFloor: "HIGH" }, "OUTPUT_SCHEMA_INVALID");
    expectIssueCode(input, { ...output, sourceStatus: "REPORTED" }, "OUTPUT_SCHEMA_INVALID");
  });
});

describe("来源REPORTED状态门禁", () => {
  const completedQualityEvent = {
    humanConfirmed: true,
    finalRecommendation: "QUALITY_ANOMALY" as const,
    qualityEventCreationSucceeded: true,
    qualityEventId: "QE-TEST-001",
  };

  it("AI建议不能产生REPORTED", () => {
    expect(canSetSourceStatusReported({ actor: "AI", ...completedQualityEvent })).toBe(false);
  });

  it("只有人工确认质量异常且质量事件创建成功才允许REPORTED", () => {
    expect(canSetSourceStatusReported({ actor: "HUMAN", ...completedQualityEvent })).toBe(true);
    expect(canSetSourceStatusReported({
      actor: "HUMAN",
      ...completedQualityEvent,
      humanConfirmed: false,
    })).toBe(false);
    expect(canSetSourceStatusReported({
      actor: "HUMAN",
      ...completedQualityEvent,
      qualityEventCreationSucceeded: false,
    })).toBe(false);
    expect(canSetSourceStatusReported({
      actor: "HUMAN",
      ...completedQualityEvent,
      qualityEventId: "",
    })).toBe(false);
  });
});
