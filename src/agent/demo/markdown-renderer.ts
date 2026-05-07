import { CapaAdvisory } from "../../domain/capa";
import { ClassificationResult } from "../../domain/classification";
import { TaskPackage } from "../../domain/task-package";
import { DemoGateResult } from "./gate";

export interface PlanDraftMarkdownInput {
  summary: string;
  classification: ClassificationResult;
  capaAdvisory?: CapaAdvisory;
  tasks: TaskPackage[];
  gate: DemoGateResult;
  openQuestions: string[];
}

export function renderPlanDraftMarkdown(input: PlanDraftMarkdownInput): string {
  const sections = [
    "# 任务拆解 Demo 草案",
    renderSummary(input.summary),
    renderClassification(input.classification),
  ];

  if (input.capaAdvisory) {
    sections.push(renderCapaAdvisory(input.capaAdvisory));
  }

  sections.push(
    renderTaskTable(input.tasks),
    renderGate(input.gate),
    renderOpenQuestions(input.openQuestions)
  );

  return sections.join("\n\n");
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

function renderTaskTable(tasks: TaskPackage[]): string {
  const rows = tasks.map((task) =>
    [
      task.id,
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
    "## WBS 任务包",
    "| task ID | title | objective | deliverables | completion criteria | due date | feedback frequency | dependencies |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

function renderGate(gate: DemoGateResult): string {
  if (gate.passed) {
    return ["## 派发门禁", "- 状态：通过"].join("\n");
  }

  return [
    "## 派发门禁",
    "- 状态：未通过",
    ...gate.missingByTask.map(
      (task) =>
        `- ${task.taskId} ${task.title} 缺失：${task.missingFields.join(", ")}`
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
