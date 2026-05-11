import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload } from "../demo/llm-schema";

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
    },
  },
};

export function buildSaveDraftHandler(opts?: { onDraftSaved?: (draft: Record<string, unknown>) => void }): ToolHandler {
  return async (args) => {
    const payload = args as Record<string, unknown>;
    const coerced = coerceLlmPlanPayload(payload);

    // Always save — just note gate issues. Don't make the model fight format.
    opts?.onDraftSaved?.(coerced as unknown as Record<string, unknown>);

    return {
      saved: true,
      taskCount: coerced.tasks.length,
      tasksSummary: coerced.tasks.map((t) => ({ id: t.id, title: t.title, objective: t.objective || "(空)" })),
      note: `已保存 ${coerced.tasks.length} 个任务。现在直接回复用户即可。`,
    };
  };
}
