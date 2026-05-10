import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "../demo/llm-schema";

export const SAVE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_draft",
    description: "保存任务草案。保存后直接回复用户即可。",
    parameters: {
      type: "object",
      properties: {
        tasks: { type: "array" },
        classification: { type: "object" },
        gateSelfCheck: { type: "object" },
      },
      required: ["tasks", "classification"],
    },
  },
};

export function buildSaveDraftHandler(opts?: { onDraftSaved?: (draft: Record<string, unknown>) => void }): ToolHandler {
  return async (args) => {
    const payload = args as Record<string, unknown>;
    const coerced = coerceLlmPlanPayload(payload);

    // Always save — just note gate issues. Don't make the model fight format.
    opts?.onDraftSaved?.(coerced as unknown as Record<string, unknown>);

    const needsMoreInfo = needsMoreInfoFromLlmPayload(coerced);
    const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMoreInfo });
    const gate = coerced.gateSelfCheck ?? { passed: true, missingByTask: [] };

    const warnings: string[] = [];
    if (!gate.passed) {
      warnings.push(`门禁未通过：${gate.missingByTask.map((m: { taskId: string; missingFields: string[] }) => `${m.taskId} 缺失 ${m.missingFields.join(",")}`).join("；")}`);
    }
    // 检查空 objective
    const emptyObjectives = coerced.tasks
      .filter((t) => !t.objective?.trim())
      .map((t) => t.id || t.title);
    if (emptyObjectives.length > 0) {
      warnings.push(`以下任务缺少 objective（任务目标）：${emptyObjectives.join(", ")}`);
    }

    return {
      saved: true,
      taskCount: coerced.tasks.length,
      gatePassed: gate.passed,
      warnings: warnings.length > 0 ? warnings : undefined,
      tasksSummary: coerced.tasks.map((t) => ({ id: t.id, title: t.title, objective: t.objective || "(空)" })),
      note: `已保存 ${coerced.tasks.length} 个任务。${warnings.length > 0 ? `注意：${warnings.join("；")}` : ""}现在直接回复用户即可。`,
    };
  };
}
