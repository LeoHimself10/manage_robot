import { existsSync, readFileSync } from "node:fs";

/**
 * Workbench project portfolio view (大项目).
 * Empty/missing config => disabled for all users (role B default).
 */
export function isWorkbenchProjectPortfolioEnabled(userId: string): boolean {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) return false;
  return listWorkbenchProjectPortfolioUserIds().has(normalizedUserId);
}

export function listWorkbenchProjectPortfolioUserIds(): Set<string> {
  const allow = new Set<string>();
  const file = process.env.WORKBENCH_PROJECT_PORTFOLIO_IDS_FILE?.trim();
  if (file && existsSync(file)) {
    try {
      const arr = JSON.parse(readFileSync(file, "utf8")) as unknown;
      if (Array.isArray(arr)) {
        arr.map((x) => String(x).trim()).filter(Boolean).forEach((id) => allow.add(id));
      }
    } catch {
      // keep reading other sources
    }
  }

  const raw = process.env.WORKBENCH_PROJECT_PORTFOLIO_USER_IDS?.trim();
  if (raw) {
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => allow.add(id));
  }
  return allow;
}
