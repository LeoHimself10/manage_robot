import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import type { LlmGateSelfCheck } from "./llm-types";

export interface PlanDraftMarkdownInput {
  summary: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  gate: LlmGateSelfCheck;
  openQuestions: string[];
}

export interface PlanDraftMarkdownOptions {
  /** user hides internal diagnostics; diagnostic preserves the original audit-oriented sections. */
  audience?: "user" | "diagnostic";
}

export function renderPlanDraftMarkdown(
  input: PlanDraftMarkdownInput,
  options: PlanDraftMarkdownOptions = {}
): string {
  if (options.audience === "diagnostic") {
    return renderDiagnosticPlanDraftMarkdown(input);
  }

  const sections = [
    ["# 任务拆解草案", "_以下草案可继续回复「再细化」「调整截止时间」「补充风险」等要求进行修改。_"].join(
      "\n\n"
    ),
    renderSummary(input.summary),
  ];

  if (input.capaAdvisory) {
    sections.push(renderCapaAdvisory(input.capaAdvisory));
  }

  sections.push(
    renderTaskTable(input.tasks, input.gate, { showGateFlags: false }),
    renderDraftSupplements(input.gate),
    renderOpenQuestions(input.openQuestions)
  );

  return sections.filter((s) => s.trim().length > 0).join("\n\n---\n\n");
}

function renderDiagnosticPlanDraftMarkdown(input: PlanDraftMarkdownInput): string {
  const sections = [
    ["# 任务拆解 Demo 草案", "_以下为摘要、分类、任务包、门禁与追问；章节之间用分隔线区分，便于阅读。_"].join(
      "\n\n"
    ),
    renderSummary(input.summary),
    renderClassification(input.classification),
  ];

  if (input.capaAdvisory) {
    sections.push(renderCapaAdvisory(input.capaAdvisory));
  }

  sections.push(
    renderTaskTable(input.tasks, input.gate, { showGateFlags: true }),
    renderGate(input.gate),
    renderOpenQuestions(input.openQuestions)
  );

  return sections.filter((s) => s.trim().length > 0).join("\n\n---\n\n");
}

function renderSummary(summary: string): string {
  return ["## 任务理解摘要", summary].join("\n\n");
}

function renderClassification(classification: ClassificationResult): string {
  return [
    "## 场景分类",
    `- 领域：${classification.domain}`,
    `- 子类型：${classification.subtype}`,
    `- 置信度：${classification.confidence}`,
    `- 判断依据：${renderListInline(classification.rationale)}`,
    `- 缺失信息：${renderListInline(classification.missingInformation)}`,
  ].join("\n");
}

function renderCapaAdvisory(capaAdvisory: CapaAdvisory): string {
  return [
    "## CAPA 建议",
    `- 建议：${capaAdvisory.advisory}`,
    `- 判断依据：${renderListInline(capaAdvisory.rationale)}`,
    `- 免责声明：${capaAdvisory.disclaimer}`,
    `- 追问问题：${renderListInline(capaAdvisory.promptingQuestions)}`,
  ].join("\n");
}

function renderTaskTable(
  tasks: TaskPackage[],
  gate: LlmGateSelfCheck,
  options: { showGateFlags: boolean }
): string {
  const flagged = new Set(
    options.showGateFlags && !gate.passed
      ? gate.missingByTask.map((m) => m.taskId.trim())
      : []
  );
  const rows = tasks.map((task) =>
    [
      flagged.has(task.id.trim()) ? `⚠ ${task.id}` : task.id,
      task.title,
      task.objective,
      renderListInline(task.deliverables),
      renderListInline(task.completionCriteria),
      task.timeNode.dueAt,
      task.feedbackFrequency,
      renderListInline(task.dependencyTaskIds),
    ]
      .map(escapeTableCell)
      .join(" | ")
  );

  return [
    "## 建议任务包",
    "| 任务ID | 任务标题 | 目标 | 交付物 | 验收标准 | 截止时间 | 反馈频率 | 依赖任务 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function renderGate(gate: LlmGateSelfCheck): string {
  if (gate.passed) {
    return ["## 派发门禁", "- 状态：通过"].join("\n");
  }

  return [
    "## 派发门禁",
    "- 状态：未通过",
    ...gate.missingByTask.map(
      (task) =>
        `- ${task.taskId} ${task.title ?? ""} 缺失：${task.missingFields.join(", ")}`
    ),
  ].join("\n");
}

function renderDraftSupplements(gate: LlmGateSelfCheck): string {
  if (gate.passed || gate.missingByTask.length === 0) {
    return "";
  }

  return [
    "## 草案待补充",
    ...gate.missingByTask.map(
      (task) =>
        `- ${task.taskId} ${task.title ?? ""} 需补充：${task.missingFields.join(", ")}`
    ),
  ].join("\n");
}

function renderOpenQuestions(openQuestions: string[]): string {
  return ["## 仍需确认的问题", renderBulletList(openQuestions)].join("\n");
}

function renderListInline(items: string[]): string {
  return items.length === 0 ? "无" : items.join("；");
}

function renderBulletList(items: string[]): string {
  if (items.length === 0) {
    return "- 无";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}
