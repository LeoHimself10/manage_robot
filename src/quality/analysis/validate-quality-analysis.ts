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
  for (const [index, name] of output.collaboratingDepartmentNames.entries()) {
    if (!allowedDepartments.has(key(name))) {
      issues.push({
        path: `collaboratingDepartmentNames.${index}`,
        message: "协同部门不在真实部门候选列表中",
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
  }
  const confirmedFacts = new Set(output.confirmedFacts.map(key));
  for (const [index, hypothesis] of output.causeHypotheses.entries()) {
    if (confirmedFacts.has(key(hypothesis))) {
      issues.push({ path: `causeHypotheses.${index}`, message: "原因假设与已确认事实重复" });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, output };
}
