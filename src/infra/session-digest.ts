import type { TaskPlanningDemoResult } from "../agent/demo/pipeline";

const DEFAULT_MAX_CHARS = 2000;

/** Markdown-free digest for planner user prompt continuity (bounded length). */
export function summarizePriorDemoForPrompt(
  result: TaskPlanningDemoResult,
  maxChars = DEFAULT_MAX_CHARS
): string | undefined {
  const lines: string[] = [];

  if (result.status === "NEEDS_MORE_INFO") {
    lines.push("上一轮系统状态：NEEDS_MORE_INFO。");
    if (result.questions.length > 0) {
      lines.push("上一轮追问：\n" + result.questions.map((q) => q.trim()).filter(Boolean).join("\n"));
    }
  } else if (result.status === "GENERATION_FAILED") {
    lines.push("上一轮生成失败。", `原因摘录：${result.reason.slice(0, 280)}`);
  } else if (result.status === "DRAFT_READY") {
    lines.push(
      "上一轮已成功生成拆解草案；若本轮用户只要求优化、细化、调整或补充，请基于以下草案修订，不要把短反馈当作新任务。",
      `领域=${result.classification.domain}，子类型=${result.classification.subtype}，置信度=${result.classification.confidence}。`
    );
    const summary = extractMarkdownSection(result.markdown, "任务理解摘要");
    if (summary) {
      lines.push(`上一轮任务理解：${oneLine(summary)}`);
    }
    if (result.capaAdvisory) {
      lines.push(
        `CAPA建议=${result.capaAdvisory.advisory}；依据=${renderInlineList(result.capaAdvisory.rationale)}`
      );
    }
    if (result.tasks.length > 0) {
      lines.push("上一轮任务包：");
      for (const task of result.tasks.slice(0, 8)) {
        lines.push(
          [
            `- ${task.id} ${task.title}`,
            `目标：${oneLine(task.objective)}`,
            `交付物：${renderInlineList(task.deliverables)}`,
            `验收：${renderInlineList(task.completionCriteria)}`,
            `截止：${task.timeNode.dueAt}`,
            `反馈：${task.feedbackFrequency}`,
            `依赖：${renderInlineList(task.dependencyTaskIds)}`,
          ].join("；")
        );
      }
    }
    if (!result.gate.passed && result.gate.missingByTask.length > 0) {
      lines.push(
        "上一轮草案待补充：" +
          result.gate.missingByTask
            .map((task) => `${task.taskId} ${task.title ?? ""}=${task.missingFields.join(",")}`)
            .join("；")
      );
    }
    if (result.questions.length > 0) {
      lines.push("仍需关注的问题：" + result.questions.slice(0, 10).join("； "));
    }
  }

  if (lines.length === 0) return undefined;
  const text = ["## 上轮上下文（请在本次输出中接续已给定事实，若无矛盾勿重复发问）", ...lines].join(
    "\n"
  );
  return text.length > maxChars ? text.slice(0, Math.max(0, maxChars - 1)) + "\n...(截断)" : text;
}

function renderInlineList(items: string[]): string {
  const values = items.map((item) => oneLine(item)).filter(Boolean);
  return values.length > 0 ? values.join("；") : "无";
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractMarkdownSection(markdown: string, heading: string): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) return undefined;
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith("## ") || line === "---") break;
    body.push(line);
  }
  const text = body.join("\n").trim();
  return text.length > 0 ? text : undefined;
}
