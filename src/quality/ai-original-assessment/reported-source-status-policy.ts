import type { AiHandlingRecommendation } from "./ai-original-assessment-contracts";

export interface ReportedSourceStatusDecision {
  actor: "AI" | "HUMAN";
  humanConfirmed: boolean;
  finalRecommendation: AiHandlingRecommendation;
  qualityEventCreationSucceeded: boolean;
  qualityEventId: string | null;
}

/**
 * AI输出只是一份建议快照，不能触发业务状态变化。
 * 来源状态只有在人工确认质量异常，且质量事件确实创建成功后，才允许变为REPORTED。
 */
export function canSetSourceStatusReported(
  decision: ReportedSourceStatusDecision,
): boolean {
  return decision.actor === "HUMAN"
    && decision.humanConfirmed
    && decision.finalRecommendation === "QUALITY_ANOMALY"
    && decision.qualityEventCreationSucceeded
    && Boolean(decision.qualityEventId?.trim());
}
