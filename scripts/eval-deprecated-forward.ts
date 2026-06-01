/**
 * Deprecated eval aliases → v3 matrix (warn once, forward).
 */
import { spawnSync } from "node:child_process";

const alias = process.argv[2]?.trim();

const FORWARD: Record<string, { cmd: string; args: string[]; extraEnv?: Record<string, string> }> = {
  "deployment-parity": { cmd: "npm", args: ["run", "eval:release"] },
  "natural-full": {
    cmd: "npm",
    args: ["run", "eval:chains"],
    extraEnv: { EVAL_CHAIN_GROUP: "core" },
  },
  "replay-transport": {
    cmd: "npm",
    args: ["run", "eval:chains"],
    extraEnv: { EVAL_CHAIN_GROUP: "core", EVAL_CHAIN_FILTER: "chain_transport" },
  },
  "portfolio-suite": { cmd: "npm", args: ["run", "eval:release"] },
  "portfolio-full": { cmd: "npm", args: ["run", "eval:release"] },
  "parity-suite": {
    cmd: "npx",
    args: ["tsx", "scripts/run-eval-spot.ts"],
    extraEnv: { EVAL_TAG: "misc" },
  },
};

const target = alias ? FORWARD[alias] : undefined;
if (!target) {
  console.error(`Unknown deprecated alias: ${alias ?? "(none)"}`);
  process.exit(1);
}

console.warn(
  `\n[DEPRECATED] eval:${alias} → use v3 matrix (see docs/eval-matrix-v3.md). Forwarding...\n`,
);

const r = spawnSync(target.cmd, target.args, {
  cwd: process.cwd(),
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, ...(target.extraEnv ?? {}) },
});
process.exit(r.status ?? 1);
