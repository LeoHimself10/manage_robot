/**
 * L3 eval:chains — multi-turn fixtures via unified manifest groups.
 * Run: npm run eval:chains
 * Group: EVAL_CHAIN_GROUP=core|portfolio|cross|all
 * Filter: EVAL_CHAIN_FILTER=chain_oct_wbs (optional)
 */
import { spawnSync } from "node:child_process";
import { writeEvalReport } from "./eval-report";
import { loadEvalV3Manifest } from "./eval-v3-manifest";

const ROOT = process.cwd();
const startedAt = new Date().toISOString();
const GROUP = (process.env.EVAL_CHAIN_GROUP?.trim() || "all").toLowerCase();
const FILTER = process.env.EVAL_CHAIN_FILTER?.trim() || process.env.EVAL_NATURAL_FILTER?.trim() || "";

function runStage(
  id: string,
  label: string,
  cmd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): { ok: boolean; exitCode: number; durationMs: number } {
  const t0 = Date.now();
  console.log(`\n========== [${id}] ${label} ==========\n`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  const ok = (r.status ?? 1) === 0;
  if (!ok) console.error(`\n[${id}] FAILED exit=${r.status}\n`);
  return { ok, exitCode: r.status ?? 1, durationMs: Date.now() - t0 };
}

function main(): void {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY required for eval:chains.");
    process.exit(1);
  }

  const manifest = loadEvalV3Manifest();
  const groups =
    GROUP === "all"
      ? Object.keys(manifest.groups)
      : GROUP.split(",").map((g) => g.trim()).filter(Boolean);

  console.log("=== eval:chains (L3) ===");
  console.log(`groups: ${groups.join(", ")}`);
  console.log(`filter: ${FILTER || "(none)"}\n`);

  const stages: Array<{
    id: string;
    label: string;
    ok: boolean;
    exitCode: number;
    durationMs: number;
    critical?: boolean;
  }> = [];

  for (const group of groups) {
    const g = manifest.groups[group];
    if (!g) {
      console.error(`Unknown group: ${group}`);
      process.exit(1);
    }

    const env: Record<string, string> = {};
    if (FILTER) {
      if (group === "core") env.EVAL_NATURAL_FILTER = FILTER;
      if (group === "portfolio") env.EVAL_PORTFOLIO_FILTER = FILTER;
      if (group === "cross") env.EVAL_CROSS_FILTER = FILTER;
    }

    if (group === "core") {
      const coreEnv = {
        ...env,
        ...(process.env.EVAL_ENGINE?.trim()
          ? { ORCHESTRATOR_ENGINE: process.env.EVAL_ENGINE.trim() }
          : {}),
      };
      const r = runStage("chains-core", g.label, "npm", ["run", "eval:natural-full-chains"], coreEnv);
      stages.push({ id: "chains-core", label: g.label, ...r, critical: true });
    } else if (group === "portfolio") {
      const r = runStage("chains-portfolio", g.label, "npm", ["run", "eval:portfolio-chains"], env);
      stages.push({ id: "chains-portfolio", label: g.label, ...r });
    } else if (group === "cross") {
      const crossEnv = { ...env, EVAL_CROSS_FILTER: env.EVAL_CROSS_FILTER || g.crossFilter || "CHAIN_full" };
      const vitest = runStage(
        "cross-vitest",
        "Canonical session vitest",
        "npx",
        ["vitest", "run", "tests/web/canonical-main-session.test.ts"],
      );
      stages.push({ id: "cross-vitest", label: "Canonical vitest", ...vitest });
      if (vitest.ok) {
        const r = runStage("chains-cross", g.label, "npm", ["run", "eval:cross-channel"], crossEnv);
        stages.push({ id: "chains-cross", label: g.label, ...r });
      }
    }
  }

  const criticalOk = stages.find((s) => s.id === "chains-core")?.ok !== false;
  const allOk = stages.every((s) => s.ok);
  const path = writeEvalReport("chains", {
    suite: "chains",
    startedAt,
    allOk,
    criticalOk,
    meta: { group: GROUP, filter: FILTER || null },
    stages,
  });
  console.log(`\nReport: ${path}`);
  if (!criticalOk && groups.includes("core")) process.exit(1);
  process.exit(allOk ? 0 : 1);
}

main();
