/**
 * Full portfolio manager agent eval orchestrator.
 * Run: npm run eval:portfolio-full
 *
 * 1) L0 vitest (portfolio UI + store)
 * 2) L2 spot (baseline + portfolio single-turn)
 * 3) L3 chains (multi-turn)
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QWEN_PLANNER_PROMPT_VERSION } from "../src/agent/demo/qwen-prompt";

const ROOT = process.cwd();
const EVAL_DIR = process.env.EVAL_DATA_DIR?.trim() || join(ROOT, ".eval-portfolio-full");

function run(label: string, cmd: string, args: string[]): number {
  console.log(`\n========== ${label} ==========\n`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error(`\n[${label}] FAILED exit=${r.status}`);
  }
  return r.status ?? 1;
}

function readSummary(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const vitestStatus = run(
  "L0 portfolio vitest",
  "npx",
  [
    "vitest",
    "run",
    "tests/web/manager-projects-portfolio.test.ts",
    "tests/infra/workbench-formal-task-store.test.ts",
  ],
);

if (vitestStatus !== 0) process.exit(vitestStatus);

if (!process.env.QWEN_API_KEY?.trim()) {
  console.error("\nQWEN_API_KEY required for LLM stages (spot + chains). L0 vitest passed.");
  process.exit(1);
}

const spotStatus = run("L2 portfolio spot", "npm", ["run", "eval:portfolio-spot"]);
if (spotStatus !== 0) process.exit(spotStatus);

const chainsStatus = run("L3 portfolio chains", "npm", ["run", "eval:portfolio-chains"]);
if (chainsStatus !== 0) process.exit(chainsStatus);

const spot = readSummary(join(EVAL_DIR, "eval-summary-spot.json"));
const chains = readSummary(join(EVAL_DIR, "eval-summary-chains.json"));

writeFileSync(
  join(EVAL_DIR, "eval-summary.json"),
  JSON.stringify(
    {
      id: "portfolio_full_v1",
      prompt: QWEN_PLANNER_PROMPT_VERSION,
      layers: {
        L0_vitest: { passed: true },
        L2_spot: spot,
        L3_chains: chains,
      },
    },
    null,
    2,
  ),
);

console.log("\n=== Portfolio Full Eval: ALL PASSED ===\n");
