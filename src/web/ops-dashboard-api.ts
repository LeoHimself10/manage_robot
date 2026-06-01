import { buildOpsDashboardFacts } from "../agent/ops-dashboard/ops-dashboard-facts";

export function handleOpsDashboardApi(url: URL): Record<string, unknown> | null {
  if (url.pathname !== "/api/workbench/admin/ops-dashboard") return null;
  const week = url.searchParams.get("week")?.trim() || undefined;
  const span = Number(url.searchParams.get("span") ?? "1") || 1;
  const facts = buildOpsDashboardFacts({ weekYmd: week, span });
  return { ok: true, ...facts };
}
