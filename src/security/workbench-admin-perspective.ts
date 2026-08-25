import type { WorkbenchRole } from "./workbench-role-resolver";

export const WORKBENCH_ADMIN_PERSPECTIVES = [
  "manager",
  "project_manager",
  "employee",
  "quality_specialist",
  "operations",
] as const;

export type WorkbenchAdminPerspective =
  (typeof WORKBENCH_ADMIN_PERSPECTIVES)[number];

export function parseWorkbenchAdminPerspective(
  value: unknown,
): WorkbenchAdminPerspective | undefined {
  const normalized = String(value ?? "").trim();
  return WORKBENCH_ADMIN_PERSPECTIVES.includes(
    normalized as WorkbenchAdminPerspective,
  )
    ? normalized as WorkbenchAdminPerspective
    : undefined;
}

export function adminPerspectiveDisplayRole(
  perspective: WorkbenchAdminPerspective,
): WorkbenchRole {
  if (perspective === "manager" || perspective === "project_manager") {
    return "manager";
  }
  if (perspective === "employee" || perspective === "quality_specialist") {
    return "employee";
  }
  return "admin";
}

export function adminPerspectiveRedirect(
  perspective: WorkbenchAdminPerspective,
): string {
  if (perspective === "operations") return "/workbench/admin/ops";
  return `/workbench/admin/perspective?view=${encodeURIComponent(perspective)}`;
}

export function adminPerspectiveLabel(
  perspective: WorkbenchAdminPerspective,
): string {
  if (perspective === "manager") return "普通主管";
  if (perspective === "project_manager") return "项目主管";
  if (perspective === "employee") return "普通员工";
  if (perspective === "quality_specialist") return "质量专员";
  return "运营看板";
}

export function isAdminQualityPerspective(
  perspective: WorkbenchAdminPerspective | undefined,
): perspective is "project_manager" | "quality_specialist" {
  return perspective === "project_manager" || perspective === "quality_specialist";
}
