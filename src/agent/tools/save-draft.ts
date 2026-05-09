import type { ToolDefinition, ToolHandler } from "../demo/qwen-compatible-client";
import { coerceLlmPlanPayload, validateLlmPlanPayload, needsMoreInfoFromLlmPayload } from "../demo/llm-schema";

export const SAVE_DRAFT_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "save_draft",
    description: "保存任务草案并触发门禁校验。传入 tasks、classification、gateSelfCheck。返回校验结果和缺失字段清单。仅在信息充足足以生成完整草案时调用。",
    parameters: {
      type: "object",
      properties: {
        tasks: { type: "array", description: "任务包数组，每个元素含 id/title/objective/deliverables/completionCriteria/timeNode/feedbackFrequency 等" },
        classification: { type: "object", description: "领域分类 {domain, subtype, confidence, rationale, missingInformation}" },
        gateSelfCheck: { type: "object", description: "门禁自检 {passed, missingByTask}" },
      },
      required: ["tasks", "classification"],
    },
  },
};

export function buildSaveDraftHandler(): ToolHandler {
  return async (args) => {
    const payload = args as Record<string, unknown>;
    const coerced = coerceLlmPlanPayload(payload);
    const needsMoreInfo = needsMoreInfoFromLlmPayload(coerced);
    const validation = validateLlmPlanPayload(coerced, { allowEmptyTasks: needsMoreInfo });
    if (!validation.valid) {
      return { saved: false, errors: validation.errors, hint: "请修正以上结构问题后重新调用 save_draft" };
    }
    const gate = coerced.gateSelfCheck ?? { passed: true, missingByTask: [] };
    return {
      saved: true,
      gatePassed: gate.passed,
      gateMissingByTask: gate.missingByTask,
      taskCount: coerced.tasks.length,
      tasks: coerced.tasks.map((t: { id: string; title: string }) => ({ id: t.id, title: t.title })),
    };
  };
}
