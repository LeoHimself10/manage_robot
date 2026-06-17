import type { WorkbenchActiveUserRow } from "../infra/workbench-usage-stats";

export type ManagerWorkbenchActiveUserPublic = {
  displayName: string;
  surfaceLabel: string;
  eventCount: number;
};

/** 主管侧工作台活跃列表不暴露 userId / surfaces 原始值（供运营看板等复用）。 */
export function sanitizeWorkbenchActiveUsersForManager(
  rows: WorkbenchActiveUserRow[],
): ManagerWorkbenchActiveUserPublic[] {
  return rows.map((row) => ({
    displayName:
      row.displayName.trim() && row.displayName !== row.userId
        ? row.displayName
        : "未知",
    surfaceLabel: managerFacingSurfaceLabel(row.surfaceLabel),
    eventCount: row.eventCount,
  }));
}

function managerFacingSurfaceLabel(label: string): string {
  const parts = String(label ?? "")
    .split(" / ")
    .map((part) => (part.trim() === "Admin" ? "主管端" : part.trim()))
    .filter(Boolean);
  return [...new Set(parts)].join(" / ") || "—";
}
