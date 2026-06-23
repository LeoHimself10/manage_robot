/**
 * Competency eval feature availability. Enabled only when COMPETENCY_EVAL_ENABLED=1/true/yes/on.
 */
export function isCompetencyEvalEnabled(): boolean {
  const raw = String(process.env.COMPETENCY_EVAL_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
