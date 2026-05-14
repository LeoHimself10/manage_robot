import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderManagerTasksPage, renderManagerChatPage } from "../src/web/manager-workbench-pages.ts";
import { renderAdminWorkbenchPage } from "../src/web/admin-workbench-pages.ts";
import { renderEmployeeNewTasksPage, renderEmployeeCurrentTasksPage } from "../src/web/employee-workbench-pages.ts";

const cases = [
  ["manager-tasks", renderManagerTasksPage({ userLabel: "测试" })],
  ["manager-chat", renderManagerChatPage({ userLabel: "测试" })],
  ["admin", renderAdminWorkbenchPage({ userLabel: "测试" })],
  ["employee-new", renderEmployeeNewTasksPage()],
  ["employee-current", renderEmployeeCurrentTasksPage()],
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
