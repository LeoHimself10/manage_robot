/**
 * Align LLM/orchestrator eval knobs with production ECS (/etc/manage-robot.env).
 * Snapshot: 2026-05-25 · manage-robot-dingtalk container on 47.243.199.153
 *
 * Eval-only overrides (notify / schedulers / contact sync) stay off unless caller opts out.
 */
import type { QwenPlannerConfig } from "../src/agent/demo/qwen-planner";
import { loadQwenPlannerConfigFromEnv } from "../src/agent/demo/qwen-planner";

export interface EvalProductionParityOptions {
  /** Keep WORKBENCH_DINGTALK_NOTIFY_ENABLED=0 etc. (default true) */
  disableSideEffects?: boolean;
  /** Skip keys already present in process.env */
  respectExisting?: boolean;
}

/** Orchestrator / Qwen / tool quota vars mirrored from live dingtalk-bot (+ code defaults where ECS omits). */
export const PRODUCTION_ORCHESTRATOR_ENV: Record<string, string> = {
  DINGTALK_ORCHESTRATOR_MAX_ITERATIONS: "30",
  AGENT_MAX_TOOL_CALLS: "16",
  AGENT_MAX_TOTAL_MS: "180000",
  AGENT_MAX_TOTAL_TOKENS: "24000",
  DINGTALK_QWEN_MAX_TOKENS: "8000",
  DINGTALK_QWEN_TIMEOUT_MS: "120000",
  DINGTALK_QWEN_THINKING: "0",
  DINGTALK_QWEN_STREAM: "1",
  QWEN_MODEL: "qwen3.6-plus",
  QWEN_MAX_TOKENS: "8000",
  QWEN_TIMEOUT_MS: "60000",
  QWEN_MAX_RETRIES: "1",
  QWEN_STREAM: "1",
  QWEN_THINKING: "0",
  DINGTALK_ROLE_ROUTING_ENABLED: "1",
  ASSIGNMENT_PHASE_ENABLED: "1",
  UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX: "12",
  DRAFT_FALLBACK_EXTRACT_ENABLED: "1",
  SEARCH_WEB_ENABLED: "1",
  SEARCH_SIMILAR_PLANS_ENABLED: "1",
  READ_URL_ENABLED: "1",
  READ_URL_PER_ORCHESTRATOR_MAX: "2",
  READ_URL_TIMEOUT_MS: "12000",
  READ_URL_MAX_BYTES: "524288",
  READ_URL_MAX_TEXT_CHARS: "12000",
  SESSION_DIGEST_MAX_CHARS: "2000",
  CHAT_SESSION_TTL_MS: "1800000",
};

const EVAL_SIDE_EFFECT_OVERRIDES: Record<string, string> = {
  WORKBENCH_DINGTALK_NOTIFY_ENABLED: "0",
  DINGTALK_CONTACT_SYNC_ENABLED: "0",
  FOLLOWUP_REMINDER_ENABLED: "0",
  PROGRESS_DIGEST_ENABLED: "0",
};

function setEnv(key: string, value: string, respectExisting: boolean) {
  if (respectExisting && process.env[key] !== undefined) return;
  process.env[key] = value;
}

export function applyEvalProductionParityEnv(opts: EvalProductionParityOptions = {}) {
  const respectExisting = opts.respectExisting ?? false;
  for (const [key, value] of Object.entries(PRODUCTION_ORCHESTRATOR_ENV)) {
    setEnv(key, value, respectExisting);
  }
  if (opts.disableSideEffects !== false) {
    for (const [key, value] of Object.entries(EVAL_SIDE_EFFECT_OVERRIDES)) {
      setEnv(key, value, respectExisting);
    }
  }
}

export function formatEvalProductionParitySummary(): string {
  const keys = [
    "DINGTALK_ORCHESTRATOR_MAX_ITERATIONS",
    "AGENT_MAX_TOOL_CALLS",
    "AGENT_MAX_TOTAL_MS",
    "DINGTALK_QWEN_MAX_TOKENS",
    "DINGTALK_QWEN_TIMEOUT_MS",
    "QWEN_MODEL",
    "READ_URL_ENABLED",
    "UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX",
  ];
  return keys.map((k) => `${k}=${process.env[k] ?? "(unset)"}`).join(", ");
}

/** Mirror dingtalk-bot clientConfig caps for eval harness turns. */
export function buildEvalDingtalkClientConfig(): QwenPlannerConfig {
  const base = loadQwenPlannerConfigFromEnv();
  if (!base) throw new Error("missing QWEN_API_KEY");
  const dingMax = Number(process.env.DINGTALK_QWEN_MAX_TOKENS ?? "8000");
  const dingTimeout = Number(process.env.DINGTALK_QWEN_TIMEOUT_MS ?? "120000");
  const thinkingRaw = String(process.env.DINGTALK_QWEN_THINKING ?? "0").trim().toLowerCase();
  return {
    ...base,
    thinking: !(thinkingRaw === "0" || thinkingRaw === "false" || thinkingRaw === "no"),
    timeoutMs: Number.isFinite(dingTimeout) ? dingTimeout : 120_000,
    maxTokens: Math.min(base.maxTokens, Number.isFinite(dingMax) ? dingMax : 8000),
    stream: String(process.env.DINGTALK_QWEN_STREAM ?? "1").trim() !== "0",
  };
}
