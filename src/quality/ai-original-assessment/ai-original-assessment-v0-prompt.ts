import type { AiOriginalAssessmentInput } from "./ai-original-assessment-contracts";

export interface AiOriginalAssessmentPromptMessage {
  role: "system" | "user";
  content: string;
}

function compactFeedback(
  source: AiOriginalAssessmentInput["sourceSnapshot"],
): Record<string, string> {
  return Object.fromEntries([
    ["sourceKey", source.sourceKey],
    ["feedbackAt", source.feedbackAt],
    ["deviceModel", source.deviceModel],
    ["serialNo", source.serialNo],
    ["catheterBatch", source.catheterBatch],
    ["issueDescription", source.issueDescription],
    ["clinicianAware", source.clinicianAware],
    ["impact", source.impact],
    ["confirmation", source.confirmation],
  ].filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && entry[1].trim().length > 0
  )));
}

/**
 * 给模型看的27行紧凑字典。正式完整字典仍保留在输入合同和服务端校验器中。
 */
export function buildCompactAiCategoryTaxonomy(
  dictionary: AiOriginalAssessmentInput["categoryDictionary"],
): string {
  return dictionary.categories.flatMap((primary) => (
    primary.secondaryCategories.map((secondary) => [
      `${primary.primaryCode}/${secondary.secondaryCode}`,
      `${primary.primaryLabel}/${secondary.secondaryLabel}`,
      secondary.definition,
      `排除：${secondary.excludedScope.join("、")}`,
    ].join(" | "))
  )).join("\n");
}

function compactHistoricalCases(
  cases: AiOriginalAssessmentInput["retrievedCases"],
): string {
  if (cases.length === 0) return "无";
  return cases.map((item) => [
    item.caseId,
    `${item.primaryCategoryCode}/${item.secondaryCategoryCode}`,
    item.riskLevel ? `风险：${item.riskLevel}` : "",
    `标题：${item.title}`,
    `摘要：${item.summary}`,
    `处理：${item.outcome}`,
  ].filter(Boolean).join(" | ")).join("\n");
}

function outputTemplate(sourceKey: string): string {
  return JSON.stringify({
    handlingRecommendation: "ORDINARY|NEEDS_INFO|QUALITY_ANOMALY",
    primaryCategoryCode: "一级编码",
    secondaryCategoryCode: "二级编码",
    riskLevel: "LOW|MEDIUM|HIGH",
    reasoningBasis: [{ statement: "判断依据", citationIds: ["F1"] }],
    similarCases: [{ caseId: "实际检索案例ID", similarityReason: "相似原因" }],
    missingInformation: [{ field: "待补字段", reason: "缺失原因" }],
    uncertainties: [{ topic: "待人工确认内容", reason: "不确定原因" }],
    citations: [{
      citationId: "F1",
      sourceType: "FEEDBACK|HISTORICAL_CASE",
      sourceId: sourceKey,
      description: "引用说明",
    }],
  });
}

export function buildAiOriginalAssessmentV0Messages(input: {
  assessmentInput: AiOriginalAssessmentInput;
}): AiOriginalAssessmentPromptMessage[] {
  const assessmentInput = input.assessmentInput;
  const sourceKey = assessmentInput.sourceSnapshot.sourceKey;
  const historicalCaseIds = assessmentInput.retrievedCases.map((item) => item.caseId);
  const citationSourceWhitelist = [
    `FEEDBACK: ${sourceKey}`,
    historicalCaseIds.length > 0
      ? `HISTORICAL_CASE: ${historicalCaseIds.join(", ")}`
      : "HISTORICAL_CASE: 无",
  ].join("\n");

  const systemMessage = [
    "你是医疗器械质量反馈的AI原始研判助手；结果仅供人工审核，不是最终结论，不得修改业务状态。",
    "只返回一个JSON对象，不要Markdown、解释、前后缀或工具调用；只返回模板内业务字段，后台审计字段由服务端补齐，不得返回业务状态字段。",
    "每条反馈只选一个主要分类；一级/二级编码必须原样取自27行分类表中的同一父子组合。按现象和分类边界判断，原因类分类必须有明确事实，不得猜测。",
    "对象边界：轴体/中段/内核/弹簧管弯折扭曲选CATHETER_BEND_SHAKE；头端/尖端/出水口/远端标记段局部变形选CATHETER_PASSAGE_SHAPE；根因不明的图像抖动选IMAGE_SHAKE_NURD；算法或测量结果异常选SOFTWARE_DATA_MEASUREMENT。",
    "只有屏幕/界面显示错误提示时，应按提示指向的实际问题分类。明确患者躁动、血管严重钙化或迂曲为主因时选CLINICAL_ANATOMY_PATIENT。",
    "描述为空、只有附件名、明确原因不清，或多个独立问题无法确定主问题时，返回OTHER_UNCLEAR/INSUFFICIENT_INFO和NEEDS_INFO；二者必须同时出现。信息充分的咨询、建议或明确非质量事项才用OTHER_UNCLEAR/OTHER_GENERAL。",
    "已有产品、成像、PIU、主机、软件或包装异常时建议QUALITY_ANOMALY；明确为一般操作、培训、患者因素或非质量事项时可建议ORDINARY。根因仍待调查不等于NEEDS_INFO，应写入missingInformation或uncertainties。",
    "风险按HIGH→MEDIUM→LOW判断：术中或生产中核心操作中断，或因异常更换器械、重启设备、改变术式，或严重安全事件，建议HIGH；需更换、维修、排查且影响明显但未中断核心操作，建议MEDIUM；轻微影响或普通咨询/培训且无中断、停机、更换，建议LOW。风险等级只是AI建议，最终由人工审核。",
    "impact和confirmation是可选字段；不得自动补写或伪造。必须填写至少一条uncertainties，明确人工待确认内容。",
    "similarCases只能使用实际检索案例ID；无案例时similarCases必须返回空数组[]。citations.sourceId只能使用引用白名单，reasoningBasis.citationIds必须指向已声明的citations.citationId。",
    "返回模板中的竖线表示枚举中选择一个值；数组无内容时返回[]，不要照抄占位文字。",
  ].join("\n");

  const userMessage = [
    `反馈：${JSON.stringify(compactFeedback(assessmentInput.sourceSnapshot))}`,
    "分类表（编码 | 名称 | 判断边界 | 主要排除项）：",
    buildCompactAiCategoryTaxonomy(assessmentInput.categoryDictionary),
    "实际检索案例：",
    compactHistoricalCases(assessmentInput.retrievedCases),
    "引用来源编号白名单：",
    citationSourceWhitelist,
    "只返回以下业务JSON结构，字段不可缺少：",
    outputTemplate(sourceKey),
  ].join("\n");

  return [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];
}
