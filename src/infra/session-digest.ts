import type { TaskPlanningDemoResult } from "../agent/demo/pipeline";
import type { ResponseIntent } from "../agent/demo/llm-types";

const DEFAULT_MAX_CHARS = 2000;

/** 钉钉多轮会话摘要：供下一轮 user prompt 使用（有界长度）。 */
export interface DemoConversationState {
  currentTopicSummary?: string;
  lastResponseIntent?: ResponseIntent;
  activeDraftBrief?: string;
  knownFacts?: string[];
  unresolvedQuestions?: string[];
  userPreferences?: string[];
  userRejectedTemplate?: boolean;
  lastUserIntent?: string;
}

function summarizeTasksBrief(
  tasks: Array<{ id: string; title: string; objective: string }>
): string {
  return tasks
    .slice(0, 8)
    .map((task) => `${task.id} ${task.title}：${oneLine(task.objective)}`)
    .join("；");
}

/** 根据本轮结果更新会话状态（内存侧，可持久化前形态）。 */
export function buildConversationStateFromResult(
  result: TaskPlanningDemoResult,
  previous?: DemoConversationState
): DemoConversationState {
  if (result.status === "CONVERSATION" && result.responseIntent === "RESET_OR_NEW_TASK") {
    return {
      lastResponseIntent: "RESET_OR_NEW_TASK",
      userRejectedTemplate: true,
      lastUserIntent: "用户要求开始新任务或停止沿用旧模板",
      knownFacts: [],
      unresolvedQuestions: [],
      activeDraftBrief: undefined,
      currentTopicSummary: undefined,
      userPreferences: [...(previous?.userPreferences ?? []), "用户不希望重复旧模板追问"],
    };
  }

  if (result.status === "CONVERSATION") {
    return {
      ...previous,
      lastResponseIntent: result.responseIntent,
      lastUserIntent: result.assistantMessage,
      unresolvedQuestions: result.questions.slice(0, 20),
      userRejectedTemplate: previous?.userRejectedTemplate ?? false,
    };
  }

  if (result.status === "DRAFT_READY") {
    return {
      ...previous,
      currentTopicSummary: `${result.classification.domain}/${result.classification.subtype}`,
      lastResponseIntent: result.responseIntent,
      activeDraftBrief: summarizeTasksBrief(result.tasks),
      knownFacts: [
        `领域=${result.classification.domain}`,
        `子类型=${result.classification.subtype}`,
        `置信度=${result.classification.confidence}`,
      ],
      unresolvedQuestions: result.questions.slice(0, 10),
      userRejectedTemplate: false,
    };
  }

  if (result.status === "GENERATION_FAILED") {
    return {
      ...previous,
      lastUserIntent: `上一轮生成失败：${oneLine(result.reason).slice(0, 120)}`,
    };
  }

  if (result.status === "NEEDS_MORE_INFO") {
    return {
      ...previous,
      unresolvedQuestions: result.questions.slice(0, 20),
    };
  }

  return previous ?? {};
}

/** Markdown-free digest for planner user prompt continuity (bounded length). */
export function summarizePriorDemoForPrompt(
  result: TaskPlanningDemoResult,
  maxChars = DEFAULT_MAX_CHARS,
  state?: DemoConversationState
): string | undefined {
  const lines: string[] = [];

  if (state) {
    lines.push("当前会话状态：");
    if (state.lastResponseIntent) {
      lines.push(`- 上轮回复意图：${state.lastResponseIntent}`);
    }
    if (state.currentTopicSummary) {
      lines.push(`- 当前主题：${state.currentTopicSummary}`);
    }
    if (state.activeDraftBrief) {
      lines.push(`- 活跃草案摘要：${state.activeDraftBrief}`);
    }
    if (state.knownFacts?.length) {
      lines.push(`- 已知事实：${state.knownFacts.join("；")}`);
    }
    if (state.unresolvedQuestions?.length) {
      lines.push(`- 未解决问题：${state.unresolvedQuestions.join("；")}`);
    }
    if (state.userPreferences?.length) {
      lines.push(`- 用户偏好：${state.userPreferences.join("；")}`);
    }
    if (state.userRejectedTemplate) {
      lines.push("- 用户已表达不希望重复旧模板或旧追问。");
    }
    if (state.lastUserIntent) {
      lines.push(`- 上轮用户/系统意图摘录：${oneLine(state.lastUserIntent)}`);
    }
  }

  if (result.status === "NEEDS_MORE_INFO") {
    lines.push("上一轮系统状态：NEEDS_MORE_INFO。");
    if (result.questions.length > 0) {
      lines.push("上一轮追问：\n" + result.questions.map((q) => q.trim()).filter(Boolean).join("\n"));
    }
  } else if (result.status === "GENERATION_FAILED") {
    lines.push("上一轮生成失败。", `原因摘录：${result.reason.slice(0, 280)}`);
  } else if (result.status === "CONVERSATION") {
    lines.push(`上一轮系统状态：CONVERSATION；回复意图=${result.responseIntent}。`);
    if (result.assistantMessage.trim()) {
      lines.push(`上一轮助手说明：${oneLine(result.assistantMessage)}`);
    }
    if (result.questions.length > 0) {
      lines.push("上一轮追问：" + result.questions.map((q) => oneLine(q)).filter(Boolean).join("；"));
    }
    if (result.classification) {
      lines.push(
        `领域=${result.classification.domain}，子类型=${result.classification.subtype}，置信度=${result.classification.confidence}。`
      );
    }
  } else if (result.status === "DRAFT_READY") {
    lines.push(
      "上一轮已成功生成拆解草案；若本轮用户只要求优化、细化、调整或补充，请基于以下草案修订，不要把短反馈当作新任务。",
      `领域=${result.classification.domain}，子类型=${result.classification.subtype}，置信度=${result.classification.confidence}。`
    );
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
