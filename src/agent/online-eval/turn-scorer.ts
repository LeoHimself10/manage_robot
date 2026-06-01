import { assertAssistantMessageQuality } from "../eval/assistant-quality";
import type { OrchestratorResult } from "../orchestrator";

export interface TurnScoreResult {
  sampled: boolean;
  passed: boolean;
  scores: Record<string, number>;
  failed: string[];
  reasons: string[];
}

export interface TurnScoreInput {
  orchResult: OrchestratorResult;
  outboundMarkdown: string;
  flags?: string[];
  forceSample?: boolean;
}

function readSampleRate(): number {
  const raw = Number(process.env.ONLINE_EVAL_SAMPLE_RATE ?? "0.05");
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(1, raw);
}

function shouldAlwaysSample(flags: string[] | undefined): boolean {
  if (process.env.ONLINE_EVAL_ALWAYS_ON_EVENTS === "0") return false;
  const always = new Set([
    "orchestrator_max_turns_exceeded",
    "false_publish_observed",
    "dingtalk_tool_name_leak",
    "orchestrator_draft_message_without_json",
  ]);
  return (flags ?? []).some((f) => always.has(f));
}

export function shouldSampleTurn(flags?: string[], forceSample?: boolean): boolean {
  if (process.env.ONLINE_EVAL_ENABLED === "0") return false;
  if (forceSample || shouldAlwaysSample(flags)) return true;
  return Math.random() < readSampleRate();
}

export function scoreTurn(input: TurnScoreInput): TurnScoreResult {
  const flags = input.flags ?? [];
  const sampled = shouldSampleTurn(flags, input.forceSample);
  if (!sampled) {
    return { sampled: false, passed: true, scores: {}, failed: [], reasons: [] };
  }

  const failed: string[] = [];
  const reasons: string[] = [];
  const scores: Record<string, number> = {};

  const hygieneIssues = assertAssistantMessageQuality(input.outboundMarkdown, {
    draftAlreadyExists: Boolean(input.orchResult.draft),
  });
  scores.hygiene = hygieneIssues.length === 0 ? 1 : 0;
  if (hygieneIssues.length) {
    failed.push("hygiene");
    reasons.push(...hygieneIssues);
  }

  if (flags.includes("false_publish_observed")) {
    failed.push("task_completion");
    reasons.push("false_publish_observed");
    scores.task_completion = 0;
  } else {
    scores.task_completion = 1;
  }

  if (flags.includes("orchestrator_max_turns_exceeded")) {
    failed.push("trajectory");
    reasons.push("max_turns_exceeded");
    scores.trajectory = 0;
  } else {
    scores.trajectory = 1;
  }

  if (flags.includes("dingtalk_tool_name_leak")) {
    failed.push("hygiene");
    reasons.push("tool_name_leak");
    scores.hygiene = 0;
  }

  const loopMs = input.orchResult.timing?.totalMs;
  if (loopMs != null && loopMs > Number(process.env.ONLINE_EVAL_LOOP_MS_WARN ?? "120000")) {
    scores.efficiency = 0.5;
    reasons.push(`slow_loop_ms=${loopMs}`);
  } else {
    scores.efficiency = 1;
  }

  return {
    sampled: true,
    passed: failed.length === 0,
    scores,
    failed,
    reasons,
  };
}
