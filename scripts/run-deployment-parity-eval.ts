import "dotenv/config";

/**
 * 部署级 Agent Eval 编排（现网 parity + 拟真话术 + 全链路覆盖）
 *
 * 阶段：
 * 1) npm test（单测 + inline-pages，非 LLM）
 * 2) eval:portfolio-suite（角色 B 零影响 + 角色 A 大项目 + assignment-gate）
 * 3) eval:cross-channel + eval:publish-short（主管工作台 / 发布确认）
 * 4) eval:wbs-manager（主管 WBS → 发布链）
 * 5) eval:natural-full（28 turn 自然语言多链，最接近真实用户）
 *
 * Run: npx tsx scripts/run-deployment-parity-eval.ts
 * Include unit tests: RUN_UNIT_TESTS=1 npx tsx scripts/run-deployment-parity-eval.ts
 * Single chain: EVAL_NATURAL_FILTER=chain_oct_wbs npx tsx scripts/run-deployment-parity-eval.ts
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyEvalProductionParityEnv, formatEvalProductionParitySummary } from "./eval-production-parity-env";

const ROOT = process.cwd();
const OUT_DIR = process.env.EVAL_DEPLOYMENT_DIR?.trim() || join(ROOT, ".eval-deployment-parity");
const startedAt = new Date().toISOString();

interface StageResult {
  id: string;
  label: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
  note?: string;
}

function runStage(id: string, label: string, cmd: string, args: string[]): StageResult {
  const t0 = Date.now();
  console.log(`\n${"=".repeat(72)}\n[${id}] ${label}\n${"=".repeat(72)}\n`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  const durationMs = Date.now() - t0;
  const ok = (r.status ?? 1) === 0;
  if (!ok) console.error(`\n[${id}] FAILED exit=${r.status} (${durationMs}ms)\n`);
  return { id, label, ok, exitCode: r.status ?? 1, durationMs };
}

function readJsonIfExists(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function main(): void {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY is required for LLM eval stages.");
    process.exit(1);
  }

  applyEvalProductionParityEnv();
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("=== Deployment Parity Agent Eval ===");
  console.log(formatEvalProductionParitySummary());
  console.log(`output: ${OUT_DIR}`);
  console.log(`started: ${startedAt}`);

  const stages: StageResult[] = [];

  if (process.env.RUN_UNIT_TESTS === "1") {
    stages.push(runStage("unit", "npm test (vitest + lint:inline-pages)", "npm", ["test"]));
    if (!stages[stages.length - 1]!.ok) {
      writeSummary(stages, false);
      process.exit(1);
    }
  }

  stages.push(
    runStage("portfolio-regression", "portfolio regression (role B)", "npm", [
      "run",
      "eval:portfolio-regression",
    ]),
  );
  stages.push(
    runStage("project-portfolio", "project portfolio (role A)", "npm", [
      "run",
      "eval:project-portfolio",
    ]),
  );
  stages.push(
    runStage("assignment-gate", "assignment-gate (natural L2)", "npm", [
      "run",
      "eval:assignment-gate",
    ]),
  );

  stages.push(
    runStage("cross-channel", "cross-channel parity", "npm", ["run", "eval:cross-channel"]),
  );
  stages.push(
    runStage("publish-short", "publish short confirm", "npm", ["run", "eval:publish-short"]),
  );
  stages.push(runStage("wbs-manager", "wbs-manager full manager chain", "npm", ["run", "eval:wbs-manager"]));

  stages.push(runStage("natural-full", "natural-full (28 turn realistic)", "npm", ["run", "eval:natural-full"]));

  const criticalOk =
    stages.find((s) => s.id === "natural-full")?.ok === true
    && stages.find((s) => s.id === "assignment-gate")?.ok === true;
  const allOk = stages.every((s) => s.ok);
  writeSummary(stages, allOk);
  if (!criticalOk) {
    console.error("\n=== Deployment Parity Eval: CRITICAL STAGE FAILED (natural-full) ===\n");
    process.exit(1);
  }
  if (!allOk) {
    console.log("\n=== Deployment Parity Eval: COMPLETED WITH NON-CRITICAL FAILURES ===\n");
    process.exit(0);
  }
  console.log("\n=== Deployment Parity Eval: ALL STAGES PASSED ===\n");
}

function writeSummary(stages: StageResult[], allOk: boolean): void {
  const payload = {
    startedAt,
    finishedAt: new Date().toISOString(),
    allOk,
    parity: formatEvalProductionParitySummary(),
    stages,
    artifacts: {
      portfolioRegression: readJsonIfExists(join(ROOT, ".eval-portfolio-regression", "eval-summary.json")),
      projectPortfolio: readJsonIfExists(join(ROOT, ".eval-project-portfolio", "eval-summary.json")),
      assignmentGate: readJsonIfExists(join(ROOT, ".eval-assignment-gate", "eval-summary.json")),
      crossChannel: readJsonIfExists(join(ROOT, ".eval-cross-channel", "eval-summary.json")),
      publishShort: readJsonIfExists(join(ROOT, ".eval-publish-short-run", "eval-summary.json"))
        ?? readJsonIfExists(join(ROOT, ".eval-publish-short", "eval-summary.json")),
      wbsManager: readJsonIfExists(join(ROOT, ".eval-wbs-manager", "eval-summary.json")),
      naturalFull: readJsonIfExists(join(ROOT, ".eval-natural-full", "eval-summary.json")),
    },
  };
  writeFileSync(join(OUT_DIR, "eval-summary.json"), JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nSummary written: ${join(OUT_DIR, "eval-summary.json")}`);
}

main();
