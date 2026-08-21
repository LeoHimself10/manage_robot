import type { ZodError } from "zod";
import {
  aiOriginalAssessmentInputSchema,
  aiOriginalAssessmentOutputSchema,
  type AiCategoryDictionary,
  type AiOriginalAssessmentInput,
  type AiOriginalAssessmentOutput,
} from "./ai-original-assessment-contracts";

export type AiOriginalAssessmentValidationIssueCode =
  | "INPUT_SCHEMA_INVALID"
  | "OUTPUT_SCHEMA_INVALID"
  | "REQUEST_ID_MISMATCH"
  | "CATEGORY_NOT_IN_DICTIONARY"
  | "CASE_CATEGORY_NOT_IN_DICTIONARY"
  | "SIMILAR_CASE_NOT_IN_INPUT"
  | "CITATION_SOURCE_NOT_IN_INPUT"
  | "REASONING_CITATION_NOT_DECLARED"
  | "HANDLING_CATEGORY_MISMATCH"
  | "PROVENANCE_MISMATCH";

export interface AiOriginalAssessmentValidationIssue {
  code: AiOriginalAssessmentValidationIssueCode;
  path: string;
  message: string;
}

export type AiOriginalAssessmentValidationResult =
  | {
    ok: true;
    input: AiOriginalAssessmentInput;
    output: AiOriginalAssessmentOutput;
  }
  | {
    ok: false;
    issues: AiOriginalAssessmentValidationIssue[];
  };

function schemaIssues(
  error: ZodError,
  code: "INPUT_SCHEMA_INVALID" | "OUTPUT_SCHEMA_INVALID",
): AiOriginalAssessmentValidationIssue[] {
  return error.issues.map((issue) => ({
    code,
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function categoryExists(
  dictionary: AiCategoryDictionary,
  primaryCategoryCode: string,
  secondaryCategoryCode: string,
): boolean {
  const primary = dictionary.categories.find(
    (category) => category.primaryCode === primaryCategoryCode,
  );
  return primary?.secondaryCategories.some(
    (category) => category.secondaryCode === secondaryCategoryCode,
  ) ?? false;
}

function addProvenanceIssue(
  issues: AiOriginalAssessmentValidationIssue[],
  path: string,
  actual: string,
  expected: string,
): void {
  if (actual === expected) return;
  issues.push({
    code: "PROVENANCE_MISMATCH",
    path,
    message: `来源版本不一致，应为 ${expected}`,
  });
}

export function validateAiOriginalAssessment(
  rawInput: unknown,
  rawOutput: unknown,
): AiOriginalAssessmentValidationResult {
  const parsedInput = aiOriginalAssessmentInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    return { ok: false, issues: schemaIssues(parsedInput.error, "INPUT_SCHEMA_INVALID") };
  }

  const parsedOutput = aiOriginalAssessmentOutputSchema.safeParse(rawOutput);
  if (!parsedOutput.success) {
    return { ok: false, issues: schemaIssues(parsedOutput.error, "OUTPUT_SCHEMA_INVALID") };
  }

  const input = parsedInput.data;
  const output = parsedOutput.data;
  const issues: AiOriginalAssessmentValidationIssue[] = [];

  if (output.requestId !== input.runMetadata.requestId) {
    issues.push({
      code: "REQUEST_ID_MISMATCH",
      path: "requestId",
      message: "输出 requestId 必须与本次输入一致",
    });
  }

  if (!categoryExists(
    input.categoryDictionary,
    output.primaryCategoryCode,
    output.secondaryCategoryCode,
  )) {
    issues.push({
      code: "CATEGORY_NOT_IN_DICTIONARY",
      path: "primaryCategoryCode,secondaryCategoryCode",
      message: "输出的一、二级分类组合不在本次输入的分类字典中",
    });
  }

  const isInsufficientInfo = output.primaryCategoryCode === "OTHER_UNCLEAR"
    && output.secondaryCategoryCode === "INSUFFICIENT_INFO";
  if ((output.handlingRecommendation === "NEEDS_INFO") !== isInsufficientInfo) {
    issues.push({
      code: "HANDLING_CATEGORY_MISMATCH",
      path: "handlingRecommendation,primaryCategoryCode,secondaryCategoryCode",
      message: "NEEDS_INFO必须且只能与OTHER_UNCLEAR/INSUFFICIENT_INFO同时使用",
    });
  }

  input.retrievedCases.forEach((historicalCase, index) => {
    if (!categoryExists(
      input.categoryDictionary,
      historicalCase.primaryCategoryCode,
      historicalCase.secondaryCategoryCode,
    )) {
      issues.push({
        code: "CASE_CATEGORY_NOT_IN_DICTIONARY",
        path: `retrievedCases.${index}`,
        message: `历史案例 ${historicalCase.caseId} 的分类不在本次输入的分类字典中`,
      });
    }
  });

  const inputCaseIds = new Set(input.retrievedCases.map((item) => item.caseId));
  output.similarCases.forEach((similarCase, index) => {
    if (!inputCaseIds.has(similarCase.caseId)) {
      issues.push({
        code: "SIMILAR_CASE_NOT_IN_INPUT",
        path: `similarCases.${index}.caseId`,
        message: `相似案例 ${similarCase.caseId} 不在本次输入案例中`,
      });
    }
  });

  output.citations.forEach((citation, index) => {
    const sourceExists = citation.sourceType === "FEEDBACK"
      ? citation.sourceId === input.sourceSnapshot.sourceKey
      : inputCaseIds.has(citation.sourceId);
    if (!sourceExists) {
      issues.push({
        code: "CITATION_SOURCE_NOT_IN_INPUT",
        path: `citations.${index}.sourceId`,
        message: `引用来源 ${citation.sourceId} 不在本次输入中`,
      });
    }
  });

  const declaredCitationIds = new Set(output.citations.map((citation) => citation.citationId));
  output.reasoningBasis.forEach((basis, basisIndex) => {
    basis.citationIds.forEach((citationId, citationIndex) => {
      if (!declaredCitationIds.has(citationId)) {
        issues.push({
          code: "REASONING_CITATION_NOT_DECLARED",
          path: `reasoningBasis.${basisIndex}.citationIds.${citationIndex}`,
          message: `判断依据引用 ${citationId} 未在 citations 中声明`,
        });
      }
    });
  });

  addProvenanceIssue(
    issues,
    "provenance.modelConfigId",
    output.provenance.modelConfigId,
    input.runMetadata.modelConfigId,
  );
  addProvenanceIssue(
    issues,
    "provenance.promptVersion",
    output.provenance.promptVersion,
    input.runMetadata.promptVersion,
  );
  addProvenanceIssue(
    issues,
    "provenance.categoryDictionaryVersion",
    output.provenance.categoryDictionaryVersion,
    input.categoryDictionary.version,
  );
  addProvenanceIssue(
    issues,
    "provenance.caseLibraryVersion",
    output.provenance.caseLibraryVersion,
    input.runMetadata.caseLibraryVersion,
  );

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, input, output };
}
