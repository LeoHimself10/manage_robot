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
    "严格区分：confirmedFacts只能写已确认事实；causeHypotheses只能写原因假设；investigationDirections只能写调查方向。不输出informationGaps，不生成固定的信息缺口清单。确有业务必要的核查事项写入handlingRequirements，供人工确认后形成任务；不得把原文已有事实写成缺失，不得把未召回历史案例当成必须补资料。",
    "不得把假设写成已确认根因，不得宣称阅读了视频、ZIP、原始设备日志或任何仅提供文件名的附件内容。humanDescription只能按人工说明引用。",
    "部门只能从departmentCandidates中选择，并仅返回departmentName；不得输出departmentId、managerUserId或具体执行人员。",
    "analysisBasis.sourceType只能逐字使用以下枚举之一：SOURCE_SNAPSHOT、AI_ORIGINAL_ASSESSMENT、MANAGER_ASSESSMENT、HISTORICAL_CASE、QUALITY_RULE、PRODUCT_KNOWLEDGE、HUMAN_ATTACHMENT_DESCRIPTION。来源反馈必须写SOURCE_SNAPSHOT，禁止写FEEDBACK、SOURCE或其他近义词。",
    "必须至少给出一个主责部门候选、一个必须成果和一个调查方向。成果名称不得为空或重复。",
    "必须成果围绕实际业务结果与可核验证据设计，不得机械生成一组××报告。成果名称写要查清或完成的结果；description写工作范围；acceptanceCriteria写可核对的证据、判定依据和完成条件。报告、照片、原始检测记录只是材料载体，提交文件本身不等于问题解决。确需检测报告时可以保留，但必须说明检验结果及证据要求。",
    "按本次事件证据和所处阶段选择必要成果，不固定套用检测、整改、验证、结案全流程。可参考的结果表达包括检测结果与异常判定、原因分析结论与证据、整改实施记录、效果验证结果；仅在本事件需要时使用，不照抄示例。不要把事件结案报告作为默认成果，终验和关闭由后续质量流程决定。",
    "不得在成果说明或验收标准预设结论，例如明确归因为临床因素、证明产品无问题。应要求依据本次证据判断原因；原因未查明时允许写明已排除因素、剩余假设及下一步调查，不强行得出根因。区分检测合格与原因已查明，二者不能互相替代。",
    "历史案例只能作为调查线索，必须注明与本事件事实的异同和适用限制；历史案例的原因、主管初步判断及原因假设不能转成本次已确认根因或指定验收答案。",
    "员工成果验收标准不得要求主管/质量经理审核批准、质量终验通过或关闭事件；这些是提交后的独立流程。标准应描述员工能交付的结果及可核验条件。",
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
      primaryDepartmentCandidates: [{ departmentName: "string", recommendationReason: "string" }],
      handlingRequirements: ["string"],
      deliverables: [{ name: "string", description: "string", acceptanceCriteria: "string" }],
      suggestedTotalDueDays: "integer 1-180",
    },
    input,
  });
  return [{ role: "system", content: system }, { role: "user", content: user }];
}
