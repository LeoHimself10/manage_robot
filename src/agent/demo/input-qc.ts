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
    patterns: [/产品|批次|版本|客户|设备|样机|工位|产线|A|B|C/],
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

export function checkInputQuality(
  request: InputQualityRequest
): InputQualityResult {
  const text = request.background.trim();
  const checks =
    request.domainHint === "RD" ? qualityChecks.slice(1) : qualityChecks;
  const missing = checks
    .filter((check) => !check.patterns.some((pattern) => pattern.test(text)))
    .map((check) => check.field);

  const questions = checks
    .filter((check) => missing.includes(check.field))
    .map((check) => check.question);

  return {
    canGenerateWbs: missing.length <= 2,
    missingFields: missing,
    questions,
  };
}
