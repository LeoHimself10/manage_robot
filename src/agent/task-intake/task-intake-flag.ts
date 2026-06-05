/**
 * Task-intake wizard availability. Enabled by default; set TASK_INTAKE_ENABLED=0
 * to hide the page, API and sidebar entry. Not gated by project portfolio.
 */
export function isTaskIntakeEnabled(): boolean {
  const raw = String(process.env.TASK_INTAKE_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
