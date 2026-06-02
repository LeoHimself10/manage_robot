/**
 * Ingest structured JSON log lines into agent_turn_metrics + daily rollup.
 * Usage: cat container.log | npx tsx scripts/ingest-structured-logs.ts
 *    or: npx tsx scripts/ingest-structured-logs.ts path/to/log.jsonl
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { getAgentMetricsStore } from "../src/infra/agent-metrics-store";
import { todayYmdInMetricsTz } from "../src/infra/metrics-day-bounds";

interface ParsedEvent {
  event?: string;
  ts?: string;
  traceId?: string;
  senderStaffId?: string;
  orchestratorLoopMs?: number;
  totalMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  toolCallsTotal?: number;
  hasDraft?: boolean;
  hasAssignment?: boolean;
}

const pending = new Map<
  string,
  {
    traceId: string;
    userId: string;
    occurredAt: string;
    loopMs?: number;
    handlerMs?: number;
    promptTokens: number;
    completionTokens: number;
    toolCalls?: number;
    hasDraft?: boolean;
    hasAssignment?: boolean;
    flags: string[];
  }
>();

function ingestLine(line: string, store: ReturnType<typeof getAgentMetricsStore>): void {
  let row: ParsedEvent;
  try {
    row = JSON.parse(line) as ParsedEvent;
  } catch {
    return;
  }
  const event = String(row.event ?? "");
  const traceId = String(row.traceId ?? "").trim();
  if (!traceId) return;

  if (!pending.has(traceId)) {
    pending.set(traceId, {
      traceId,
      userId: "unknown",
      occurredAt: String(row.ts ?? new Date().toISOString()),
      promptTokens: 0,
      completionTokens: 0,
      flags: [],
    });
  }
  const agg = pending.get(traceId)!;

  if (row.ts) agg.occurredAt = String(row.ts);

  if (event === "orchestrator_done") {
    agg.loopMs = Number(row.orchestratorLoopMs ?? 0) || undefined;
    agg.toolCalls = Number(row.toolCallsTotal ?? 0) || undefined;
    agg.hasDraft = Boolean(row.hasDraft);
    agg.hasAssignment = Boolean(row.hasAssignment);
  }

  if (event === "orchestrator_iteration_timing") {
    agg.promptTokens += Number(row.promptTokens ?? 0);
    agg.completionTokens += Number(row.completionTokens ?? 0);
  }

  if (event === "dingtalk_handler_timing") {
    agg.handlerMs = Number(row.totalMs ?? 0) || undefined;
  }

  if (event === "dingtalk_role_routing" && row.senderStaffId) {
    agg.userId = String(row.senderStaffId);
  }

  const incidentEvents = new Set([
    "false_publish_observed",
    "dingtalk_tool_name_leak",
    "orchestrator_max_turns_exceeded",
    "orchestrator_draft_message_without_json",
  ]);
  if (incidentEvents.has(event)) {
    agg.flags.push(event);
  }

  if (event === "orchestrator_done") {
    if (store.hasTurnMetric(agg.traceId)) {
      pending.delete(traceId);
      return;
    }
    store.insertTurnMetric({
      traceId: agg.traceId,
      userId: agg.userId,
      channel: "dingtalk",
      occurredAt: agg.occurredAt,
      loopMs: agg.loopMs,
      handlerMs: agg.handlerMs,
      toolCalls: agg.toolCalls,
      promptTokens: agg.promptTokens || undefined,
      completionTokens: agg.completionTokens || undefined,
      hasDraft: agg.hasDraft,
      hasAssignment: agg.hasAssignment,
      flags: agg.flags,
    });
    pending.delete(traceId);
  }
}

async function main(): Promise<void> {
  const store = getAgentMetricsStore();
  const path = process.argv[2]?.trim();
  const input = path ? createReadStream(path, { encoding: "utf8" }) : process.stdin;
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lines = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    lines += 1;
    ingestLine(line, store);
  }
  const today = todayYmdInMetricsTz();
  store.rollupDailyForDate(today);
  console.log(`Ingested ${lines} log line(s); rollup for ${today}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
