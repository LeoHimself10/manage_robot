import type { QualityAnalysisInput } from "./quality-analysis-contracts";
import {
  QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
  QUALITY_ANALYSIS_PROMPT_VERSION,
} from "./quality-analysis-contracts";

export function buildQualityAnalysisMessages(input: QualityAnalysisInput): Array<{
  role: "system" | "user";
  content: string;
}> {
  const system = [
    `promptVersion: ${QUALITY_ANALYSIS_PROMPT_VERSION}`,
    "你是医疗器械质量事件的初析助手。只输出一个JSON对象，不要Markdown、解释或代码围栏。",
    `schemaVersion必须为${QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION}，requestId必须逐字返回输入requestId。`,
    "严格区分：confirmedFacts只能写已确认事实；causeHypotheses只能写原因假设；investigationDirections只能写调查方向；informationGaps只能写信息缺口。",
    "不得把假设写成已确认根因，不得宣称阅读了视频、ZIP、原始设备日志或任何仅提供文件名的附件内容。humanDescription只能按人工说明引用。",
    "部门只能从departmentCandidates中选择，并仅返回departmentName；不得输出departmentId、managerUserId或具体执行人员。",
    "analysisBasis.sourceType只能逐字使用以下枚举之一：SOURCE_SNAPSHOT、AI_ORIGINAL_ASSESSMENT、MANAGER_ASSESSMENT、HISTORICAL_CASE、QUALITY_RULE、PRODUCT_KNOWLEDGE、HUMAN_ATTACHMENT_DESCRIPTION。来源反馈必须写SOURCE_SNAPSHOT，禁止写FEEDBACK、SOURCE或其他近义词。",
    "必须至少给出一个主责部门候选、一个必须成果和一个调查方向。成果名称不得为空或重复。",
    "confirmedCategoryReference只读引用输入中的人工确认分类，不得修改分类。",
    "所有字段均须严格符合给定JSON合同，不得增加字段。",
  ].join("\n");
  const user = JSON.stringify({
    task: "基于已保存的真实质量事件数据生成结构化AI质量初析草稿",
    outputContract: {
      schemaVersion: QUALITY_ANALYSIS_OUTPUT_SCHEMA_VERSION,
      requestId: input.runMetadata.requestId,
      problemDirection: "string",
      confirmedCategoryReference: "string",
      sourceFactSummary: ["string"],
      confirmedFacts: ["string"],
      analysisBasis: [{
        statement: "string",
        sourceType: "SOURCE_SNAPSHOT | AI_ORIGINAL_ASSESSMENT | MANAGER_ASSESSMENT | HISTORICAL_CASE | QUALITY_RULE | PRODUCT_KNOWLEDGE | HUMAN_ATTACHMENT_DESCRIPTION",
        sourceReference: "string",
      }],
      preliminaryConclusion: "string",
      causeHypotheses: ["string"],
      investigationDirections: ["string"],
      informationGaps: ["string"],
      primaryDepartmentCandidates: [{ departmentName: "string", recommendationReason: "string" }],
      collaboratingDepartmentNames: ["string"],
      handlingRequirements: ["string"],
      deliverables: [{ name: "string", description: "string", acceptanceCriteria: "string" }],
      suggestedTotalDueDays: "integer 1-180",
    },
    input,
  });
  return [{ role: "system", content: system }, { role: "user", content: user }];
}
