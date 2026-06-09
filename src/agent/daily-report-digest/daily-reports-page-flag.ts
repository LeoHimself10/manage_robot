/**
 * 「日报汇总」工作台页面的可用性开关（实例级功能分叉）。
 *
 * 默认关闭：仅在 env 设置 DAILY_REPORTS_PAGE_ENABLED=1 时显示页面、API 与侧栏入口。
 * 这样可在 mingsibot 的 env 打开、managebot 不配 → 该功能只在明思出现，
 * 同一套代码/镜像无需拆库即可按实例启停。
 */
export function isDailyReportsPageEnabled(): boolean {
  const raw = String(process.env.DAILY_REPORTS_PAGE_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
