import { CapaAdvisory, CAPA_DISCLAIMER } from "../../domain/capa";
import { TaskSubtype } from "../../domain/classification";
import { PlanDomain } from "../harness/types";

export interface CapaAdvisoryRequest {
  domain: PlanDomain;
  subtype: TaskSubtype;
  background: string;
}

export function adviseCapa(request: CapaAdvisoryRequest): CapaAdvisory {
  if (request.domain !== "QUALITY") {
    return {
      advisory: "NOT_REQUIRED",
      rationale: ["当前任务被分类为研发任务，Demo 阶段不建议触发 CAPA 判断。"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [],
    };
  }

  const text = request.background;
  if (
    request.subtype === "CUSTOMER_COMPLAINT_OR_FIELD_ISSUE" ||
    /客户|客诉|现场|售后|已出货|安全|法规|批量|重复|召回/.test(text)
  ) {
    return {
      advisory: "RECOMMENDED",
      rationale: [
        "输入包含客户/现场/已出货或潜在安全法规风险线索。",
        "建议质量授权人员进一步评估是否进入 CAPA 流程。",
      ],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: ["请确认影响范围、重复性和当前遏制措施。"],
    };
  }

  if (text.length < 20 || request.subtype === "QUALITY_OTHER_OR_UNCERTAIN") {
    return {
      advisory: "INSUFFICIENT_INFO",
      rationale: ["输入信息不足，无法判断是否建议进一步评估 CAPA。"],
      disclaimer: CAPA_DISCLAIMER,
      promptingQuestions: [
        "是否涉及客户、已出货产品或现场使用？",
        "是否存在批量性、重复性或安全/法规风险？",
        "是否已有临时遏制措施？",
      ],
    };
  }

  return {
    advisory: "UNCERTAIN",
    rationale: ["当前信息显示为质量问题，但 CAPA 触发条件仍不充分。"],
    disclaimer: CAPA_DISCLAIMER,
    promptingQuestions: [
      "是否存在重复发生？",
      "是否影响客户、批量产品或法规承诺？",
    ],
  };
}
