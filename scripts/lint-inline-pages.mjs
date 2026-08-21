import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderManagerTasksPage, renderManagerChatPage } from "../src/web/manager-workbench-pages.ts";
import { renderManagerProjectsPage } from "../src/web/manager-projects-pages.ts";
import { renderManagerDashboardPage } from "../src/web/manager-dashboard-page.ts";
import { renderDailyReportsPage } from "../src/web/daily-reports-page.ts";
import { renderAdminWorkbenchPage } from "../src/web/admin-workbench-pages.ts";
import { renderEmployeeWorkbenchPage } from "../src/web/employee-workbench-pages.ts";
import { renderTaskDetailPage } from "../src/web/assignment-workbench.ts";
import { renderQualityTrackingPage } from "../src/web/quality-tracking-page.ts";
import { renderQualityReviewPage } from "../src/web/quality-review-page.ts";

const cases = [
  ["manager-tasks", renderManagerTasksPage({ userLabel: "测试" })],
  ["manager-chat", renderManagerChatPage({ userLabel: "测试" })],
  ["manager-projects", renderManagerProjectsPage({ userLabel: "测试" })],
  ["manager-dashboard", renderManagerDashboardPage({ userLabel: "测试" })],
  ["manager-daily-reports", renderDailyReportsPage({ role: "manager", activeNav: "mgr-daily-reports", userLabel: "测试" })],
  ["employee-daily-reports", renderDailyReportsPage({ role: "employee", activeNav: "emp-daily-reports" })],
  ["admin-daily-reports", renderDailyReportsPage({ role: "admin", activeNav: "adm-daily-reports", canManageRoster: true })],
  ["manager-tasks-portfolio", renderManagerTasksPage({ userLabel: "测试", projectPortfolioEnabled: true })],
  ["admin", renderAdminWorkbenchPage({ userLabel: "测试" })],
  ["employee-unified", renderEmployeeWorkbenchPage()],
  ["quality-tracking", renderQualityTrackingPage({ role: "manager", userId: "test", canReport: true, isSpecialist: true })],
  ["quality-review", renderQualityReviewPage({ role: "manager", userId: "test" })],
  [
    "manager-task-detail",
    renderTaskDetailPage({
      roleLabel: "manager",
      backPath: "/workbench/manager/tasks",
      enforceActionGuards: false,
    }),
  ],
];

const dir = mkdtempSync(join(tmpdir(), "lint-inline-"));
let failed = 0;

function extractFirstScript(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const body = match[1].trim();
    if (body.length > 0) return body;
  }
  return "";
}

for (const [name, html] of cases) {
  const code = extractFirstScript(html);
  if (!code) {
    console.error(`[${name}] no inline script found`);
    failed++;
    continue;
  }
  const file = join(dir, `${name}.mjs`);
  writeFileSync(file, code, "utf8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    console.log(`[${name}] ok`);
  } catch (err) {
    failed++;
    console.error(`[${name}] FAILED`);
    console.error(String(err.stderr || err));
  }
}

if (failed > 0) {
  console.error(`\n${failed} page(s) failed inline script syntax check`);
  process.exit(1);
}
