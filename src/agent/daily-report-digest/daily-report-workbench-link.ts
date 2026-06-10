export type DailyReportsViewMode = "project" | "company";

export function buildDailyReportsPublicUrl(input: {
  dateYmd: string;
  view?: DailyReportsViewMode;
  role?: "manager" | "employee" | "admin";
}): string {
  const base = String(process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) return "";
  const role = input.role ?? "manager";
  const path =
    role === "employee"
      ? "/workbench/employee/daily-reports"
      : role === "admin"
        ? "/workbench/admin/daily-reports"
        : "/workbench/manager/daily-reports";
  const params = new URLSearchParams();
  if (input.dateYmd) params.set("date", input.dateYmd);
  params.set("view", input.view ?? "project");
  const qs = params.toString();
  return qs ? `${base}${path}?${qs}` : `${base}${path}`;
}
