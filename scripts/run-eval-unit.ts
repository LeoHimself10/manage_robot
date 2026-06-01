/**
 * L0 eval:unit — all deterministic vitest (no LLM).
 * Run: npm run eval:unit
 */
import { spawnSync } from "node:child_process";
import { writeEvalReport } from "./eval-report";

const ROOT = process.cwd();
const startedAt = new Date().toISOString();

const VITEST_TARGETS = [
  "tests/agent/assignment/assignment-gate-invariants.test.ts",
  "tests/agent/assignment/assignment-scope-conversation.test.ts",
  "tests/web/canonical-main-session.test.ts",
  "tests/security/url-fetch-guard.test.ts",
  "tests/integrations/url-fetch/fetch-url-content.test.ts",
  "tests/agent/tools/read-url.test.ts",
  "tests/integrations/dingtalk/extract-message-text.test.ts",
  "tests/web/manager-projects-portfolio.test.ts",
  "tests/infra/workbench-formal-task-store.test.ts",
  "tests/web/meeting-import.test.ts",
  "tests/agent/meeting-import/relation-rules.test.ts",
  "tests/infra/meeting-import-store.test.ts",
  "tests/agent/online-eval/turn-metric-flags.test.ts",
  "tests/agent/online-eval/turn-scorer.test.ts",
  "tests/agent/online-eval/online-judge.test.ts",
  "tests/security/workbench-capabilities.test.ts",
  "tests/view/workbench-chat-link.test.ts",
  "tests/agent/role-routing.test.ts",
];

function main(): void {
  console.log("=== eval:unit (L0) ===\n");
  const t0 = Date.now();
  const r = spawnSync("npx", ["vitest", "run", ...VITEST_TARGETS], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const durationMs = Date.now() - t0;
  const ok = (r.status ?? 1) === 0;
  const path = writeEvalReport("unit", {
    suite: "unit",
    startedAt,
    allOk: ok,
    stages: [
      {
        id: "vitest",
        label: "Eval-related vitest",
        ok,
        exitCode: r.status ?? 1,
        durationMs,
        critical: true,
      },
    ],
  });
  console.log(`\nReport: ${path}`);
  process.exit(ok ? 0 : 1);
}

main();
