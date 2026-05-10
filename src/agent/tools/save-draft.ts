import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "../demo/llm-schema";

export const SAVE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_draft",
    description: "保存任务草案并触发门禁校验。调用后本轮必须 stopReason=end_turn 并输出 message+完整 draft JSON。",
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
    const needsMoreInfo = needsMoreInfoFromLlmPayload(coerced);
    const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMoreInfo });
    if (!validation.valid) {
      return {
        saved: false,
        errors: validation.errors,
        hint: "以上字段缺失或格式错误，请在 draft JSON 中修正后重新调用 save_draft",
      };
    }
    // Store validated draft for orchestrator to pick up
    opts?.onDraftSaved?.(coerced as unknown as Record<string, unknown>);
    const gate = coerced.gateSelfCheck ?? { passed: true, missingByTask: [] };
    return {
      saved: true,
      gatePassed: gate.passed,
      gateMissingByTask: gate.missingByTask,
      taskCount: coerced.tasks.length,
      draftsSaved: "草案已保存。现在你必须输出 stopReason=end_turn + message(草案摘要) + 完整 draft JSON。不要再调任何工具。",
    };
  };
}
