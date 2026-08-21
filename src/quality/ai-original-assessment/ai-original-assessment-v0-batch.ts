import {
  AiOriginalAssessmentV0RunError,
  runAiOriginalAssessmentV0,
  type AiOriginalAssessmentV0RunResult,
  type PreparedAiOriginalAssessmentV0,
} from "./ai-original-assessment-v0-runner";
import type { AiOriginalAssessmentModelAdapter } from
  "./qwen-ai-original-assessment-model";

export interface AiOriginalAssessmentV0BatchItem {
  batchItemId: string;
  prepared: PreparedAiOriginalAssessmentV0;
}

export type AiOriginalAssessmentV0BatchItemResult =
  | {
    batchItemId: string;
    ok: true;
    result: AiOriginalAssessmentV0RunResult;
  }
  | {
    batchItemId: string;
    ok: false;
    error: {
      code: "MODEL_CALL_FAILED" | "MODEL_OUTPUT_INVALID" | "UNEXPECTED_ERROR";
      message: string;
      validationIssues: AiOriginalAssessmentV0RunError["validationIssues"];
    };
  };

export interface AiOriginalAssessmentV0BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  items: AiOriginalAssessmentV0BatchItemResult[];
}

/**
 * V0批量验收按条隔离失败：任意一条模型或校验失败都会被记录，后续记录继续运行。
 */
export async function runAiOriginalAssessmentV0Batch(input: {
  model: AiOriginalAssessmentModelAdapter;
  items: AiOriginalAssessmentV0BatchItem[];
  onItemComplete?: (
    result: AiOriginalAssessmentV0BatchItemResult,
    completed: number,
    total: number,
  ) => void | Promise<void>;
}): Promise<AiOriginalAssessmentV0BatchResult> {
  const items: AiOriginalAssessmentV0BatchItemResult[] = [];

  for (const item of input.items) {
    let itemResult: AiOriginalAssessmentV0BatchItemResult;
    try {
      const result = await runAiOriginalAssessmentV0({
        model: input.model,
        prepared: item.prepared,
      });
      itemResult = { batchItemId: item.batchItemId, ok: true, result };
    } catch (error) {
      if (error instanceof AiOriginalAssessmentV0RunError) {
        itemResult = {
          batchItemId: item.batchItemId,
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            validationIssues: error.validationIssues,
          },
        };
      } else {
        itemResult = {
          batchItemId: item.batchItemId,
          ok: false,
          error: {
            code: "UNEXPECTED_ERROR",
            message: error instanceof Error ? error.message : String(error),
            validationIssues: [],
          },
        };
      }
    }
    items.push(itemResult);
    await input.onItemComplete?.(itemResult, items.length, input.items.length);
  }

  const succeeded = items.filter((item) => item.ok).length;
  return {
    total: items.length,
    succeeded,
    failed: items.length - succeeded,
    items,
  };
}
