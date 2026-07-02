import {
  callTaskIntakeLlm,
  extractJsonFromLlmContent,
  loadTaskIntakePolicy,
  type TaskIntakePolicy,
} from "./task-intake-llm";
import type { TaskIntakeStructured, TaskIntakeSubtask } from "./types";

export type TaskIntakeSourceKind = "pasted" | "meeting_transcript";

const SYSTEM_PROMPT = [
  "你是任务录入助手。输入可能是三类内容：明确的任务列表、有清晰待办的会议纪要、没有清晰待办的会议纪要/会议原文。",
  "你的职责是先判断输入类型，再把可执行事项转为结构化 JSON；如果没有明确待办，必须返回空 subtasks。",
  "",
  "输入类型处理：",
  "1. 明确的任务列表：用户列了几条任务，就输出几条 subtasks；禁止增加、删除、合并或再拆分条目；标题尽量保留用户措辞。",
  "2. 有清晰待办的会议纪要：只提取会议中已经形成的明确行动项/负责人承诺/下一步安排，可按行动项生成 subtasks；不要把整段纪要逐行拆成任务。",
  "3. 没有清晰待办的会议纪要：如果只有背景、讨论、观点、同步信息、寒暄、议程或结论但没有可执行行动，输出 subtasks: []。",
  "4. 会议原文转写：只从会议原文中提取明确待办；它不是钉钉 AI 纪要摘要，也不是已整理的待办清单。",
  "",
  "硬性纪律（不可违反）：",
  "1. 禁止把背景讨论、观点、寒暄或会议标题扩写成任务。",
  "2. dueAt 用 YYYY-MM-DD，仅当用户给了明确日期时填写。",
  "3. 只提到模糊时间（如「三天左右」「本周内」「尽快」）时，不填 dueAt；改填 dueMode='self'，并把原话写到 dueExpectation。",
  "4. assigneeName 仅当用户明确写了负责人姓名时填写，禁止编造。",
  "5. actions / dependsOn 仅当用户明确提及时填写，禁止编造。",
  "6. 对会议纪要/转写，只能提取明确待办；不确定的事项宁可不入库。",
  "",
  "必填字段（有 subtask 时必须输出，可根据上下文合理推断，勿留空）：",
  "A. parentDescription：用 1-2 句话说明这批任务的整体目标与背景，供下属理解来龙去脉。",
  "B. 每条 subtask 的 objective：用一句话说明该子任务的核心目标。若用户未明确，根据标题合理推断。",
  "C. 每条 subtask 的 deliverables：该子任务完成后产出的具体交付物（如文档/报告/代码/方案），多项用「；」分隔。若用户未明确，根据任务标题合理推断 1 条。",
  "D. 每条 subtask 的 completionCriteria：可量化/可验收的完成标准，多项用「；」分隔。若用户未明确，根据任务标题合理推断 1 条。",
  "",
  "可选字段（仅用户明确提及时填写）：actions / dependsOn / dueAt（YYYY-MM-DD）/ dueMode / dueExpectation / assigneeName。",
  "",
  "输出严格 JSON，不要任何解释或 markdown：",
  '{ "parentTitle": string, "parentDescription": string, "subtasks": [ { "title": string, "objective": string, "deliverables": string, "completionCriteria": string, "actions"?: string, "dependsOn"?: string, "dueAt"?: string, "dueMode"?: "fixed" | "self", "dueExpectation"?: string, "assigneeName"?: string } ] }',
].join("\n");

function clip(value: unknown, max = 500): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Deterministic line-based splitter used when the LLM is unavailable or fails. */
export function splitLinesToSubtasks(text: string): TaskIntakeSubtask[] {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•·]\s*/, "")
        .replace(/^\d+[.、)]\s*/, "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .map((title) => ({ title: title.slice(0, 200) }));
}

function coerceStructured(parsed: unknown): TaskIntakeStructured | null {
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.subtasks)) return null;
  const rawSubtasks = obj.subtasks;
  const subtasks: TaskIntakeSubtask[] = rawSubtasks
    .map((raw) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const title = clip(r.title, 200);
      if (!title) return null;
      // deliverables / completionCriteria are required fields — always set them
      // (model should have generated a draft; we preserve whatever it returned).
      const subtask: TaskIntakeSubtask = {
        title,
        objective: clip(r.objective),
        deliverables: clip(r.deliverables),
        completionCriteria: clip(r.completionCriteria),
      };
      const actions = clip(r.actions);
      const dependsOn = clip(r.dependsOn);
      const dueAt = clip(r.dueAt, 32);
      const dueModeRaw = clip(r.dueMode, 16).toLowerCase();
      const dueExpectation = clip(r.dueExpectation, 200);
      const assigneeName = clip(r.assigneeName, 64);
      if (actions) subtask.actions = actions;
      if (dependsOn) subtask.dependsOn = dependsOn;
      if (dueAt) subtask.dueAt = dueAt;
      if (dueModeRaw === "fixed" || dueModeRaw === "self") {
        subtask.dueMode = dueModeRaw;
      } else if (!dueAt && dueExpectation) {
        subtask.dueMode = "self";
      }
      if (dueExpectation) subtask.dueExpectation = dueExpectation;
      if (assigneeName) subtask.assigneeName = assigneeName;
      return subtask;
    })
    .filter((s): s is TaskIntakeSubtask => s !== null);
  if (rawSubtasks.length > 0 && subtasks.length === 0) return null;
  return {
    parentTitle: clip(obj.parentTitle, 200),
    parentDescription: clip(obj.parentDescription, 2000),
    subtasks,
  };
}

export interface StructureTasksResult {
  structured: TaskIntakeStructured;
  warnings: string[];
  usedFallback: boolean;
}

export async function structureTasksFromText(input: {
  pastedText: string;
  parentTitleHint?: string;
  sourceKind?: TaskIntakeSourceKind;
  sourceTitle?: string;
  policy?: TaskIntakePolicy;
}): Promise<StructureTasksResult> {
  const warnings: string[] = [];
  const pasted = String(input.pastedText ?? "").trim();
  const hint = String(input.parentTitleHint ?? "").trim();
  const sourceKind: TaskIntakeSourceKind =
    input.sourceKind === "meeting_transcript" ? "meeting_transcript" : "pasted";
  const sourceTitle = String(input.sourceTitle ?? "").trim();

  if (!pasted) {
    return {
      structured: { parentTitle: hint, parentDescription: "", subtasks: [] },
      warnings: ["empty_content"],
      usedFallback: false,
    };
  }

  const policy = input.policy ?? loadTaskIntakePolicy();
  const userMessage = [
    hint ? `父任务标题（用户已指定，请直接采用）：${hint}` : "父任务标题：用户未指定，请从内容中提炼一个简洁标题。",
    sourceTitle ? `来源标题（仅用于理解背景，不要机械套用为任务标题）：${sourceTitle}` : "",
    "",
    sourceKind === "meeting_transcript"
      ? "以下内容来自会议原文转写（录音转文字），不是钉钉 AI 纪要摘要。请只从会议原文中提取明确待办："
      : "以下内容可能是任务清单，也可能是会议纪要/会议原文。请先判断类型，再提取可入库的明确待办：",
    pasted,
  ].filter(Boolean).join("\n");

  const raw = await callTaskIntakeLlm({ system: SYSTEM_PROMPT, user: userMessage, policy });
  if (raw) {
    const coerced = coerceStructured(extractJsonFromLlmContent(raw));
    if (coerced) {
      const nextWarnings = coerced.subtasks.length === 0
        ? [...warnings, "no_clear_action_items"]
        : warnings;
      return {
        structured: {
          parentTitle: hint || coerced.parentTitle || sourceTitle || "新建任务",
          parentDescription: coerced.parentDescription,
          subtasks: coerced.subtasks,
        },
        warnings: nextWarnings,
        usedFallback: false,
      };
    }
    warnings.push("ai_parse_failed_fallback_lines");
  } else {
    warnings.push("ai_unavailable_fallback_lines");
  }

  if (sourceKind === "meeting_transcript") {
    return {
      structured: {
        parentTitle: hint || sourceTitle || "会议转写待办",
        parentDescription: "",
        subtasks: [],
      },
      warnings: [...warnings, "meeting_transcript_ai_extract_failed"],
      usedFallback: false,
    };
  }

  const subtasks = splitLinesToSubtasks(pasted);
  return {
    structured: {
      parentTitle: hint || (subtasks[0]?.title ?? "新建任务"),
      parentDescription: "",
      subtasks,
    },
    warnings: [...warnings, "未启用/未命中 AI，已按行拆分，请核对每条任务"],
    usedFallback: true,
  };
}
