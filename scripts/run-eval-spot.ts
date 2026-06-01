/**
 * L2 eval:spot — single-turn LLM by tag.
 * Run: npm run eval:spot
 * Tags: EVAL_TAG=assignment|portfolio|misc|read-url|roles|wbs-domain|all
 */
import { spawnSync } from "node:child_process";
import { writeEvalReport } from "./eval-report";
import { resolveSpotTags } from "./eval-v3-manifest";

const ROOT = process.cwd();
const startedAt = new Date().toISOString();
const TAG = (process.env.EVAL_TAG?.trim() || "all").toLowerCase();

interface StageResult {
  id: string;
  label: string;
  ok: boolean;
  exitCode: number;
  durationMs: number;
}

function runNpm(id: string, label: string, script: string, extraEnv: Record<string, string> = {}): StageResult {
  const t0 = Date.now();
  console.log(`\n========== [${id}] ${label} ==========\n`);
  const r = spawnSync("npm", ["run", script], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  const ok = (r.status ?? 1) === 0;
  if (!ok) console.error(`\n[${id}] FAILED exit=${r.status}\n`);
  return { id, label, ok, exitCode: r.status ?? 1, durationMs: Date.now() - t0 };
}

function runTsx(id: string, label: string, scriptPath: string, extraEnv: Record<string, string> = {}): StageResult {
  const t0 = Date.now();
  console.log(`\n========== [${id}] ${label} ==========\n`);
  const r = spawnSync("npx", ["tsx", scriptPath], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  const ok = (r.status ?? 1) === 0;
  return { id, label, ok, exitCode: r.status ?? 1, durationMs: Date.now() - t0 };
}

function main(): void {
  if (!process.env.QWEN_API_KEY?.trim()) {
    console.error("QWEN_API_KEY required for eval:spot LLM stages.");
    process.exit(1);
  }

  const tags = resolveSpotTags(TAG);
  console.log("=== eval:spot (L2) ===");
  console.log(`EVAL_TAG=${TAG} → [${tags.join(", ")}]\n`);

  const stages: StageResult[] = [];

  for (const tag of tags) {
    switch (tag) {
      case "assignment":
        stages.push(
          runTsx("assignment-llm", "Assignment gate LLM", "scripts/run-assignment-gate-eval.ts"),
        );
        break;
      case "portfolio":
        stages.push(runNpm("portfolio-regression", "Portfolio role B regression", "eval:portfolio-regression"));
        stages.push(runNpm("portfolio-spot", "Portfolio spot", "eval:portfolio-spot"));
        break;
      case "misc":
        stages.push(runNpm("publish-short", "Publish short confirm", "eval:publish-short"));
        stages.push(
          runTsx("scope-switch", "Assignment scope switch", "scripts/run-assignment-scope-switch-eval.ts"),
        );
        break;
      case "read-url":
        stages.push(runNpm("read-url", "read_url eval", "eval:read-url"));
        break;
      case "roles":
        stages.push(runNpm("agent-smoke", "Agent role smoke", "eval:agent"));
        break;
      case "wbs-domain":
        stages.push(
          runTsx("wbs-domain", "WBS domain spots", "scripts/run-wbs-manager-eval.ts", {
            EVAL_WBS_FILTER: "W3_rd_release,W6_eco_hardware,W7_supplier_iqc,W9_line_changeover",
          }),
        );
        break;
      default:
        console.warn(`Unknown spot tag skipped: ${tag}`);
    }
  }

  const allOk = stages.length > 0 && stages.every((s) => s.ok);
  const path = writeEvalReport("spot", {
    suite: "spot",
    startedAt,
    allOk,
    meta: { tag: TAG, tags },
    stages,
  });
  console.log(`\nReport: ${path}`);
  process.exit(allOk ? 0 : 1);
}

main();
