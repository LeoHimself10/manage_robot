import { PlanDomain } from "../harness/types";

export interface InputQualityRequest {
  domainHint?: PlanDomain;
  background: string;
}

export interface InputQualityResult {
  canGenerateWbs: boolean;
  missingFields: string[];
  questions: string[];
}

const criticalQualityFields = new Set([
  "problemSource",
  "productOrBatch",
  "problemPhenomenon",
  "impactScope",
]);

const unknownValuePattern = /待确认|未知|不清楚|未确认|待补充|不明确/;

const unknownCriticalContextPatterns: Record<string, RegExp[]> = {
  problemSource: [
    /(?:问题来源|来源|生产|产线|检验|测试|客诉|客户|售后|供应商|来料).{0,8}(?:待确认|未知|不清楚|未确认|待补充|不明确)/,
    /(?:待确认|未知|不清楚|未确认|待补充|不明确).{0,8}(?:问题来源|来源|生产|产线|检验|测试|客诉|客户|售后|供应商|来料)/,
  ],
  productOrBatch: [
    /(?:产品|批次|版本|客户|设备|样机|工位|产线|使用场景).{0,8}(?:待确认|未知|不清楚|未确认|待补充|不明确)/,
    /(?:待确认|未知|不清楚|未确认|待补充|不明确).{0,8}(?:产品|批次|版本|客户|设备|样机|工位|产线|使用场景)/,
  ],
  problemPhenomenon: [
    /(?:问题现象|现象|异常|失败|不良|报错|偏差|失效|升高|降低|不通过).{0,8}(?:待确认|未知|不清楚|未确认|待补充|不明确)/,
    /(?:待确认|未知|不清楚|未确认|待补充|不明确).{0,8}(?:问题现象|现象|异常|失败|不良|报错|偏差|失效|升高|降低|不通过)/,
  ],
  impactScope: [
    /(?:影响范围|影响|范围|数量|台|批|出货|库存|在制|已发货|未发货).{0,8}(?:待确认|未知|不清楚|未确认|待补充|不明确)/,
    /(?:待确认|未知|不清楚|未确认|待补充|不明确).{0,8}(?:影响范围|影响|范围|数量|台|批|出货|库存|在制|已发货|未发货)/,
  ],
};

const qualityChecks: Array<{
  field: string;
  question: string;
  patterns: RegExp[];
}> = [
  {
    field: "problemSource",
    question: "问题来源是什么？例如生产异常、检验/测试异常、客诉/售后、供应商问题。",
    patterns: [/生产|产线|检验|测试|客诉|客户|售后|供应商|来料/],
  },
  {
    field: "productOrBatch",
    question: "涉及哪个产品、批次、版本、客户或使用场景？",
    patterns: [
      /[A-Z0-9][A-Z0-9_-]*\s*产品/i,
      /(?:产品|批次|版本|设备|样机|工位|产线)\s*[A-Z0-9][A-Z0-9_-]*/i,
      /\d{4}-\d{2}-\d{2}\s*批次/,
      /(?:客户|使用场景)\s*[:：]?\s*[\u4e00-\u9fa5A-Z0-9_-]{2,}/i,
    ],
  },
  {
    field: "problemPhenomenon",
    question: "具体问题现象是什么？请描述异常表现、频次或检测结果。",
    patterns: [/异常|失败|不良|报错|偏差|失效|升高|降低|不通过/],
  },
  {
    field: "impactScope",
    question: "影响范围是什么？涉及数量、批次、客户、库存、在制品或出货状态。",
    patterns: [/影响|范围|数量|台|批|出货|库存|在制|已发货|未发货/],
  },
  {
    field: "evidence",
    question: "已有证据有哪些？例如照片、视频、测试记录、检验报告、生产记录。",
    patterns: [/记录|报告|照片|视频|数据|证据|日志|截图/],
  },
  {
    field: "timeConstraint",
    question: "期望完成时间或关键时间约束是什么？",
    patterns: [/今天|明天|两天|2天|本周|截止|完成|T\+|小时|天内/],
  },
];

const rdChecks: Array<{
  field: string;
  question: string;
  patterns: RegExp[];
}> = [
  {
    field: "rdTaskType",
    question: "这属于哪类研发任务？例如需求/设计输入、方案论证、验证确认或设计变更。",
    patterns: [/研发|需求|设计输入|方案|论证|V&V|验证|确认|设计变更|ECN/],
  },
  {
    field: "rdObject",
    question: "研发任务对象是什么？例如产品、模块、样机、版本、需求或风险项。",
    patterns: [/产品|模块|样机|版本|需求|风险|设备|系统|硬件|软件|结构|算法/],
  },
  {
    field: "expectedOutput",
    question: "期望输出是什么？例如方案、验证计划、测试方法、样本量、通过准则或评审材料。",
    patterns: [/输出|方案|计划|方法|样本量|通过准则|评审材料|报告|矩阵|清单/],
  },
  {
    field: "timeConstraint",
    question: "期望完成时间或关键时间约束是什么？",
    patterns: [/今天|明天|两天|2天|本周|截止|完成|T\+|小时|天内|工作日/],
  },
];

function hasUnknownCriticalContext(field: string, text: string): boolean {
  if (!criticalQualityFields.has(field) || !unknownValuePattern.test(text)) {
    return false;
  }

  return (
    unknownCriticalContextPatterns[field]?.some((pattern) =>
      pattern.test(text)
    ) ?? false
  );
}

export function checkInputQuality(
  request: InputQualityRequest
): InputQualityResult {
  const text = request.background.trim();
  const checks = request.domainHint === "RD" ? rdChecks : qualityChecks;
  const missing = checks
    .filter(
      (check) =>
        !check.patterns.some((pattern) => pattern.test(text)) ||
        hasUnknownCriticalContext(check.field, text)
    )
    .map((check) => check.field);

  const questions = checks
    .filter((check) => missing.includes(check.field))
    .map((check) => check.question);
  const hasMissingCriticalQualityField =
    request.domainHint !== "RD" &&
    missing.some((field) => criticalQualityFields.has(field));

  return {
    canGenerateWbs: !hasMissingCriticalQualityField && missing.length <= 2,
    missingFields: missing,
    questions,
  };
}
