import { existsSync } from "node:fs";
import { join } from "node:path";
import { logStructured } from "../../infra/logger";
import { getAgentMetricsStore, type AgentMetricsChannel } from "../../infra/agent-metrics-store";
import { resolveMetricsTimezone, todayYmdInMetricsTz } from "../../infra/metrics-day-bounds";
import type { OrchestratorResult } from "../orchestrator";
import { runOnlineJudge, shouldRunOnlineJudge } from "./online-judge";
import { buildRecentContextFromHistory, redactTurnText, type RedactedTurnContext } from "./recent-context";
import { buildTurnMetricFlags } from "./turn-metric-flags";
import { scoreTurn } from "./turn-scorer";

export interface RecordAgentTurnMetricsInput {
  traceId: string;
  userId: string;
  channel: AgentMetricsChannel;
  userMessage: string;
  orchResult: OrchestratorResult;
  outboundMarkdown: string;
  preTurnDraft?: Record<string, unknown>;
  recentContext?: RedactedTurnContext[];
  handlerMs?: number;
  flags?: string[];
  publishOk?: boolean;
  judgeModelConfig?: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
  };
}

function sumTokens(orchResult: OrchestratorResult): { prompt: number; completion: number } {
  let prompt = 0;
  let completion = 0;
  for (const it of orchResult.timing?.iterations ?? []) {
    const row = it as { promptTokens?: number; completionTokens?: number };
    prompt += Number(row.promptTokens ?? 0);
    completion += Number(row.completionTokens ?? 0);
  }
  return { prompt, completion };
}

function resolvePlanSnapshotPath(traceId: string): string | undefined {
  const planDir = process.env.PLAN_STORE_DIR?.trim() || join(process.cwd(), "data/plans");
  const planPath = join(planDir, `${traceId}.json`);
  return existsSync(planPath) ? planPath : undefined;
}

export function recordAgentTurnMetricsAsync(input: RecordAgentTurnMetricsInput): void {
  if (process.env.AGENT_METRICS_ENABLED === "0") return;
  setImmediate(() => {
    void (async () => {
      try {
        const store = getAgentMetricsStore();
        if (store.hasTurnMetric(input.traceId)) return;

        const flags =
          input.flags
          ?? buildTurnMetricFlags({
            userMessage: input.userMessage,
            orchResult: input.orchResult,
            preTurnDraft: input.preTurnDraft,
            outboundMarkdown: input.outboundMarkdown,
            publishOk: input.publishOk,
            channel: input.channel,
          });

        const ruleScore = scoreTurn({
          orchResult: input.orchResult,
          outboundMarkdown: input.outboundMarkdown,
          flags,
          forceSample: undefined,
        });

        const userMessageRedacted = redactTurnText(input.userMessage, 2000);
        const assistantMessageRedacted = redactTurnText(input.outboundMarkdown, 4000);
        const recentContext = input.recentContext ?? [];

        let judgeBlock: Record<string, unknown> | undefined;
        let judgeFailed = false;
        if (ruleScore.sampled && shouldRunOnlineJudge(true) && input.judgeModelConfig) {
          const judge = await runOnlineJudge({
            userMessage: userMessageRedacted,
            assistantReply: assistantMessageRedacted,
            recentContext,
            metadata: {
              hasDraft: Boolean(input.orchResult.draft),
              hasAssignment: Boolean(input.orchResult.assignment),
              publishOk: input.publishOk,
              toolCalls: input.orchResult.toolCallsTotal,
              flags,
            },
            modelConfig: input.judgeModelConfig,
          });
          judgeBlock = {
            skipped: judge.skipped,
            overallPass: judge.overallPass,
            scores: judge.scores,
            reasons: judge.reasons,
            promptVersion: judge.promptVersion,
            error: judge.error,
          };
          if (!judge.skipped && !judge.overallPass) {
            judgeFailed = true;
            flags.push("online_judge_fail");
          }
          if (judge.error) flags.push("online_judge_error");
        }

        const passed = ruleScore.passed && !judgeFailed;
        const qualityScores = ruleScore.sampled
          ? {
              passed,
              rules: {
                passed: ruleScore.passed,
                scores: ruleScore.scores,
                reasons: ruleScore.reasons,
              },
              judge: judgeBlock,
              reasons: [
                ...ruleScore.reasons,
                ...(judgeBlock && judgeBlock.skipped !== true && judgeBlock.overallPass === false
                  ? ((judgeBlock.reasons as string[]) ?? [])
                  : []),
              ],
            }
          : undefined;

        const tokens = sumTokens(input.orchResult);
        const occurredAt = new Date().toISOString();
        store.insertTurnMetric({
          traceId: input.traceId,
          userId: input.userId,
          channel: input.channel,
          occurredAt,
          loopMs: input.orchResult.timing?.totalMs,
          handlerMs: input.handlerMs,
          toolCalls: input.orchResult.toolCallsTotal,
          promptTokens: tokens.prompt || undefined,
          completionTokens: tokens.completion || undefined,
          hasDraft: Boolean(input.orchResult.draft),
          hasAssignment: Boolean(input.orchResult.assignment),
          publishOk: input.publishOk,
          flags,
          qualityScores,
          outcome: ruleScore.sampled ? (passed ? "ok" : "quality_fail") : "unsampled",
        });
        try {
          const tz = resolveMetricsTimezone();
          const dayYmd = todayYmdInMetricsTz(new Date(occurredAt));
          store.rollupDailyForDate(dayYmd, tz);
        } catch {
          // rollup is best-effort
        }

        if (ruleScore.sampled && !passed) {
          const planSnapshotPath = resolvePlanSnapshotPath(input.traceId);
          store.insertEvalCandidate({
            traceId: input.traceId,
            planSnapshotPath,
            userMessageRedacted,
            assistantMessageRedacted,
            contextJson: recentContext,
            ruleScoresJson: ruleScore.scores,
            judgeScoresJson: judgeBlock,
            failReasons: qualityScores?.reasons ?? ruleScore.reasons,
          });
          logStructured({
            event: "online_eval_turn_failed",
            traceId: input.traceId,
            userId: input.userId,
            reasons: (qualityScores?.reasons ?? ruleScore.reasons).slice(0, 5),
          });
        }
      } catch (err) {
        logStructured({
          event: "agent_metrics_record_failed",
          traceId: input.traceId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

export { buildRecentContextFromHistory };
