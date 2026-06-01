/**
 * L4 eval:release — deduplicated release gate (v3 matrix).
 * Run: npm run eval:release
 * Strict: EVAL_STRICT_ALL=1 → any stage fail exits 1
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { applyEvalProductionParityEnv, formatEvalProductionParitySummary } from "./eval-production-parity-env";
import { loadEvalV3Manifest } from "./eval-v3-manifest";
import { writeEvalReport, type EvalReportStage } from "./eval-report";
import { appendEvalHistory } from "./eval-history-append";

const ROOT = process.cwd();
const OUT_DIR = process.env.EVAL_RELEASE_DIR?.trim() || join(ROOT, ".eval-release");
const startedAt = new Date().toISOString();
const STRICT = process.env.EVAL_STRICT_ALL === "1";

function runStage(
  id: string,
  label: string,
  cmd: string,
  args: string[],
  opts: { critical?: boolean; extraEnv?: Record<string, string> } = {},
): EvalReportStage {
  const t0 = Date.now();
  console.log(`\n${"=".repeat(72)}\n[${id}] ${label}\n${"=".repeat(72)}\n`);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      EVAL_DATA_DIR: join(OUT_DIR, id),
      ...(opts.extraEnv ?? {}),
    },
  });
  const durationMs = Date.now() - t0;
  const ok = (r.status ?? 1) === 0;
  if (!ok) console.error(`\n[${id}] FAILED exit=${r.status} (${durationMs}ms)\n`);
  return {
    id,
    label,
    ok,
    exitCode: r.status ?? 1,
    durationMs,
    critical: opts.critical,
  };
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
  applyEvalProductionParityEnv();
  mkdirSync(OUT_DIR, { recursive: true });
  loadEvalV3Manifest();

  console.log("=== eval:release (L4) ===");
  console.log(formatEvalProductionParitySummary());
  console.log(`output: ${OUT_DIR}`);
  console.log(`started: ${startedAt}\n`);

  const stages: EvalReportStage[] = [];

  stages.push(runStage("unit", "L0 eval:unit", "npm", ["run", "eval:unit"], { critical: true }));
  if (!stages.at(-1)!.ok && STRICT) process.exit(1);

  stages.push(
    runStage("integration", "L1 eval:integration", "npm", ["run", "eval:integration"], { critical: true }),
  );
  stages.push(
    runStage("portfolio-regression", "Portfolio role B regression", "npm", ["run", "eval:portfolio-regression"], {
      critical: true,
    }),
  );

  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("\nQWEN_API_KEY required for LLM chain stages.\n");
    writeAndExit(stages);
  }

  stages.push(
    runStage("chains-core", "L3 core chains (28 turn)", "npx", ["tsx", "scripts/run-eval-chains.ts"], {
      critical: true,
      extraEnv: { EVAL_CHAIN_GROUP: "core" },
    }),
  );
  stages.push(
    runStage("chains-portfolio", "L3 portfolio chains", "npx", ["tsx", "scripts/run-eval-chains.ts"], {
      extraEnv: { EVAL_CHAIN_GROUP: "portfolio" },
    }),
  );
  stages.push(
    runStage("chains-cross", "L3 cross-channel chain", "npx", ["tsx", "scripts/run-eval-chains.ts"], {
      extraEnv: { EVAL_CHAIN_GROUP: "cross" },
    }),
  );
  stages.push(
    runStage("meeting-import", "Meeting import M1–M4", "npm", ["run", "eval:meeting-import"], {
      extraEnv: { EVAL_MEETING_IMPORT_SKIP_VITEST: "1" },
    }),
  );

  writeAndExit(stages);
}

function writeAndExit(stages: EvalReportStage[]): void {
  const criticalOk =
    stages.find((s) => s.id === "unit")?.ok === true
    && stages.find((s) => s.id === "portfolio-regression")?.ok === true
    && stages.find((s) => s.id === "chains-core")?.ok === true;
  const allOk = stages.every((s) => s.ok);

  process.env.EVAL_DATA_DIR = OUT_DIR;
  const payload = {
    suite: "release" as const,
    startedAt,
    allOk,
    criticalOk,
    stages,
    artifacts: {
      unit: readJsonIfExists(join(OUT_DIR, "unit", "eval-summary.json")),
      integration: readJsonIfExists(join(OUT_DIR, "integration", "eval-summary.json")),
      chainsCore: readJsonIfExists(join(OUT_DIR, "chains-core", "eval-summary.json")),
      chainsPortfolio: readJsonIfExists(join(OUT_DIR, "chains-portfolio", "eval-summary.json")),
      chainsCross: readJsonIfExists(join(OUT_DIR, "chains-cross", "eval-summary.json")),
      meetingImport:
        readJsonIfExists(join(OUT_DIR, "meeting-import", "report.json"))
        ?? readJsonIfExists(join(ROOT, ".eval-meeting-import", "report.json")),
    },
  };

  const path = writeEvalReport("release", payload);
  appendEvalHistory(payload);
  console.log(`\nSummary: ${path}`);
  console.log(`criticalOk=${criticalOk} allOk=${allOk}`);

  if (!criticalOk) process.exit(1);
  if (STRICT && !allOk) process.exit(1);
  if (!allOk) {
    console.log("\n=== eval:release: COMPLETED WITH NON-CRITICAL FAILURES ===\n");
    process.exit(0);
  }
  console.log("\n=== eval:release: ALL STAGES PASSED ===\n");
}

main();
