/**
 * Competency eval feature availability. Enabled only when COMPETENCY_EVAL_ENABLED=1/true/yes/on.
 */
export function isCompetencyEvalEnabled(): boolean {
  const raw = String(process.env.COMPETENCY_EVAL_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** 能力评估页 LLM thinking；默认开启（`COMPETENCY_EVAL_QWEN_THINKING=0` 关闭）。 */
export function readCompetencyEvalThinkingEnabled(): boolean {
  const raw = String(process.env.COMPETENCY_EVAL_QWEN_THINKING ?? "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return true;
}
