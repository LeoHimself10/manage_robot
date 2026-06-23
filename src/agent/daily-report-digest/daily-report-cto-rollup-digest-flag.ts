function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (raw === "") return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/** viewer 级合并早报（默认开）：同一 userid 只收 1 条，不再按 projectView 连发。 */
export function isCtoRollupDigestEnabled(): boolean {
  return envFlag("DAILY_REPORT_CTO_ROLLUP_DIGEST_ENABLED", true);
}

/** 合并早报去重用的虚拟 view_id（SQLite state 表）。 */
export const CTO_ROLLUP_DIGEST_STATE_VIEW_ID = "_cto_rollup_";
