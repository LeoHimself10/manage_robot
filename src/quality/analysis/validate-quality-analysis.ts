import type { QualityAnalysisInput } from "./quality-analysis-contracts";
import {
  qualityAnalysisOutputSchema,
  type QualityAnalysisOutput,
} from "./quality-analysis-contracts";

export interface QualityAnalysisValidationIssue {
  path: string;
  message: string;
}

function key(value: string): string {
  return value.trim().toLocaleLowerCase("zh-CN").replace(/\s+/g, " ");
}

export function validateQualityAnalysisOutput(
  input: QualityAnalysisInput,
  raw: unknown,
): { ok: true; output: QualityAnalysisOutput } | {
  ok: false;
  issues: QualityAnalysisValidationIssue[];
} {
  const parsed = qualityAnalysisOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const output = parsed.data;
  const issues: QualityAnalysisValidationIssue[] = [];
  if (output.requestId !== input.runMetadata.requestId) {
    issues.push({ path: "requestId", message: "请求编号与输入不一致" });
  }
  if (output.confirmedCategoryReference
    !== (input.ruleContext.confirmedCategoryReadOnly ?? "未提供人工确认分类")) {
    issues.push({ path: "confirmedCategoryReference", message: "人工确认分类引用被模型改写" });
  }
  const allowedDepartments = new Set(
    input.departmentCandidates.map((item) => key(item.departmentName)),
  );
  for (const [index, candidate] of output.primaryDepartmentCandidates.entries()) {
    if (!allowedDepartments.has(key(candidate.departmentName))) {
      issues.push({
        path: `primaryDepartmentCandidates.${index}.departmentName`,
        message: "建议部门不在真实部门候选列表中",
      });
    }
  }
  const deliverableNames = new Set<string>();
  for (const [index, deliverable] of output.deliverables.entries()) {
    const normalized = key(deliverable.name);
    if (deliverableNames.has(normalized)) {
      issues.push({ path: `deliverables.${index}.name`, message: "必须成果名称重复" });
    }
    deliverableNames.add(normalized);
    for (const message of validateDeliverableOutcome(deliverable)) {
      issues.push({path: `deliverables.${index}`, message});
    }
  }
  const confirmedFacts = new Set(output.confirmedFacts.map(key));
  for (const [index, hypothesis] of output.causeHypotheses.entries()) {
    if (confirmedFacts.has(key(hypothesis))) {
      issues.push({ path: `causeHypotheses.${index}`, message: "原因假设与已确认事实重复" });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, output };
}

/** Conservative checks for explicit anti-patterns; not a substitute for human review. */
export function validateDeliverableOutcome(item: {name: string; description: string; acceptanceCriteria: string}): string[] {
  const issues: string[] = [];
  const clauses = (item.description + "；" + item.acceptanceCriteria).split(/[。；;\n]/)
    .map(text => text.trim()).filter(text => text && !/^(?:无需|不需要|不得|不以|不能以|不要求|禁止)/.test(text));
  if (/^(?:事件|质量事件)?结案报告$/.test(item.name.trim()))
    issues.push("初析成果应描述调查结果与证据，不得默认要求事件结案；结案属于后续质量流程");
  if (clauses.some(text => /(?:主管|经理|负责人|质量人员|质量部门|质量部).{0,12}(?:审核|审批|批准|签字).{0,8}(?:通过|批准|完成)|(?:经|由).{0,10}(?:主管|经理|负责人).{0,8}(?:批准|签字)|(?:终验通过|关闭质量事件|完成事件关闭)/.test(text)))
    issues.push("员工交付标准不能以主管批准、终验通过或事件关闭为条件");
  if (clauses.some(text => /(?:明确|必须|应当|确保|证明).{0,5}(?:归因于|归因为|是由|属于临床|产品无问题|产品无异常)/.test(text)))
    issues.push("成果不得预设根因或排除产品问题，应依据本次证据判断并允许原因未明");
  if (/^(?:完成|提交|提供|出具|形成|上传).{0,20}(?:报告|文档|文件)[。！!]?$/u.test(item.acceptanceCriteria.trim()))
    issues.push("验收不能仅要求提交文档，请写明结果、证据与判定条件");
  return issues;
}
