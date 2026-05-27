import type { PlanSession } from "../../infra/plan-session-store";
import { isWorkbenchProjectPortfolioEnabled } from "../../security/workbench-project-portfolio";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

/** Portfolio 主管发布时解析 projectId；非 portfolio 恒为 undefined（不落库绑定）。 */
export function resolvePublishProjectIdForSession(
  session: PlanSession,
  managerUserId: string,
): string | undefined {
  if (!isWorkbenchProjectPortfolioEnabled(managerUserId)) return undefined;
  const draft = session.latestDraft as Record<string, unknown> | undefined;
  const fromDraft = asString(draft?.projectId);
  const fromActive = asString(session.activeProjectId);
  const pid = fromDraft || fromActive;
  return pid || undefined;
}
