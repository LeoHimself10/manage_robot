export type CapaAdvisoryValue =
  | "NOT_REQUIRED"
  | "RECOMMENDED"
  | "UNCERTAIN"
  | "INSUFFICIENT_INFO";

export interface CapaAdvisory {
  advisory: CapaAdvisoryValue;
  rationale: string[];
  disclaimer: string;
  promptingQuestions: string[];
}

export const CAPA_DISCLAIMER =
  "该建议仅用于任务拆解与质量沟通参考，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。";
