import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "../demo/llm-schema";

export const SAVE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_draft",
    description: "保存任务草案。调用后 stopReason=end_turn，不要再调任何工具。",
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

    return {
      saved: true,
      taskCount: coerced.tasks.length,
      gatePassed: gate.passed,
      warnings: warnings.length > 0 ? warnings : undefined,
      note: "草案已保存。model must output stopReason=end_turn now。不要再调工具。",
    };
  };
}
