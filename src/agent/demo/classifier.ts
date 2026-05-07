import { ClassificationResult } from "../../domain/classification";

export interface ClassifyTaskRequest {
  background: string;
}

interface Rule {
  subtype: ClassificationResult["subtype"];
  domain: ClassificationResult["domain"];
  rationale: string;
  patterns: RegExp[];
}

const rules: Rule[] = [
  {
    domain: "QUALITY",
    subtype: "PRODUCTION_PROCESS_ABNORMALITY",
    rationale: "输入包含生产、产线、批次或过程异常线索",
    patterns: [/生产|产线|工位|过程|批次|不良率/],
  },
  {
    domain: "QUALITY",
    subtype: "INSPECTION_OR_TEST_ABNORMALITY",
    rationale: "输入包含检验或测试异常线索",
    patterns: [/检验|测试异常|复测|IQC|IPQC|OQC|不通过/],
  },
  {
    domain: "QUALITY",
    subtype: "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE",
    rationale: "输入包含客户、客诉、现场或售后线索",
    patterns: [/客户|客诉|现场|售后|退回|投诉/],
  },
  {
    domain: "QUALITY",
    subtype: "SUPPLIER_ISSUE",
    rationale: "输入包含供应商或来料线索",
    patterns: [/供应商|来料|外协|采购|原材料/],
  },
  {
    domain: "RD",
    subtype: "DESIGN_CHANGE_ACTION",
    rationale: "输入包含 ECN、回归验证、影响评估或设计变更行动项线索",
    patterns: [/ECN|回归验证|影响评估|设计变更行动项/],
  },
  {
    domain: "QUALITY",
    subtype: "DESIGN_RELATED_QUALITY_TASK",
    rationale: "输入包含设计缺陷或设计变更线索",
    patterns: [/设计缺陷|设计相关|设计变更|结构缺陷|硬件缺陷|软件缺陷/],
  },
  {
    domain: "RD",
    subtype: "VERIFICATION_AND_VALIDATION",
    rationale: "输入包含验证确认或测试方案线索",
    patterns: [/V&V|验证|确认|测试方案|样本量|通过准则/],
  },
  {
    domain: "RD",
    subtype: "REQUIREMENT_OR_DESIGN_INPUT",
    rationale: "输入包含需求或设计输入线索",
    patterns: [/需求|设计输入|用户场景|临床场景|约束/],
  },
  {
    domain: "RD",
    subtype: "SOLUTION_DEVELOPMENT",
    rationale: "输入包含方案开发或论证线索",
    patterns: [/方案|论证|系统|硬件|软件|结构|选型/],
  },
];

export function classifyTask(request: ClassifyTaskRequest): ClassificationResult {
  const text = request.background.trim();
  const matched = rules.find((rule) =>
    rule.patterns.some((pattern) => pattern.test(text))
  );

  if (!matched) {
    return {
      domain: "QUALITY",
      subtype: "QUALITY_OTHER_OR_UNCERTAIN",
      confidence: "LOW",
      rationale: ["输入信息不足，无法稳定判断任务类型"],
      missingInformation: ["任务来源", "问题现象", "影响范围"],
    };
  }

  return {
    domain: matched.domain,
    subtype: matched.subtype,
    confidence: text.length > 20 ? "HIGH" : "MEDIUM",
    rationale: [matched.rationale],
    missingInformation: [],
  };
}
