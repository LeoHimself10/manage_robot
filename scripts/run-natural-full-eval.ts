/**
 * Full natural-language eval orchestrator (production parity):
 * 1) assignment-gate vitest + L2 gate
 * 2) read_url infra vitest
 * 3) natural-full multi-chain v2 (含 read_url 混合链)
 *
 * Run: npm run eval:natural-full
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const root = process.cwd();

function run(label: string, cmd: string, args: string[]) {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\n[${label}] FAILED exit=${r.status}`);
    process.exit(r.status ?? 1);
  }
}

run("assignment-gate (vitest + L2)", "npm", ["run", "eval:assignment-gate"]);

console.log("\n========== read_url infra (vitest) ==========\n");
const readUrlVitest = spawnSync(
  "npx",
  [
    "vitest",
    "run",
    "tests/security/url-fetch-guard.test.ts",
    "tests/integrations/url-fetch/fetch-url-content.test.ts",
    "tests/agent/tools/read-url.test.ts",
    "tests/integrations/dingtalk/extract-message-text.test.ts",
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: process.env },
);
if (readUrlVitest.status !== 0) {
  console.error("\n[read_url infra vitest] FAILED");
  process.exit(readUrlVitest.status ?? 1);
}

run("natural-full-chains v2", "npm", ["run", "eval:natural-full-chains"]);

console.log("\n=== Natural Full Eval v2: ALL PASSED ===\n");
