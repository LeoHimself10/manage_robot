import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";

export type AgentMetricsChannel = "dingtalk" | "workbench" | "unknown";

export interface AgentTurnMetricInput {
  traceId: string;
  userId: string;
  channel: AgentMetricsChannel;
  occurredAt?: string;
  loopMs?: number;
  handlerMs?: number;
  toolCalls?: number;
  promptTokens?: number;
  completionTokens?: number;
  hasDraft?: boolean;
  hasAssignment?: boolean;
  publishOk?: boolean;
  flags?: string[];
  qualityScores?: Record<string, unknown>;
  outcome?: string;
}

export interface AgentUsageDailyRow {
  date: string;
  channel: AgentMetricsChannel;
  activeUsers: number;
  turnCount: number;
  promptTokens: number;
  completionTokens: number;
  avgLoopMs: number;
  p90LoopMs: number;
  incidentCount: Record<string, number>;
}

export interface EvalCandidateRow {
  id: string;
  traceId: string;
  planSnapshotPath?: string;
  userMessageRedacted?: string;
  assistantMessageRedacted?: string;
  contextJson?: RedactedTurnContext[];
  ruleScoresJson?: Record<string, unknown>;
  judgeScoresJson?: Record<string, unknown>;
  failReasons: string[];
  status: "pending" | "promoted" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface RedactedTurnContext {
  role: "user" | "assistant";
  content: string;
}

function migrateEvalCandidateColumns(db: DatabaseSync): void {
  const cols = db.prepare(`PRAGMA table_info(eval_candidates)`).all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  const add = (col: string, ddl: string) => {
    if (!names.has(col)) db.exec(`ALTER TABLE eval_candidates ADD COLUMN ${ddl}`);
  };
  add("assistant_message_redacted", "assistant_message_redacted TEXT");
  add("context_json", "context_json TEXT");
  add("rule_scores_json", "rule_scores_json TEXT");
  add("judge_scores_json", "judge_scores_json TEXT");
}

function ensureSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_turn_metrics (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      channel TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      loop_ms INTEGER,
      handler_ms INTEGER,
      tool_calls INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      has_draft INTEGER,
      has_assignment INTEGER,
      publish_ok INTEGER,
      flags_json TEXT,
      quality_scores_json TEXT,
      outcome TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_turn_metrics_occurred ON agent_turn_metrics(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_agent_turn_metrics_user ON agent_turn_metrics(user_id, occurred_at);

    CREATE TABLE IF NOT EXISTS agent_usage_daily (
      date TEXT NOT NULL,
      channel TEXT NOT NULL,
      active_users INTEGER NOT NULL,
      turn_count INTEGER NOT NULL,
      prompt_tokens INTEGER NOT NULL,
      completion_tokens INTEGER NOT NULL,
      avg_loop_ms REAL NOT NULL,
      p90_loop_ms REAL NOT NULL,
      incident_count_json TEXT NOT NULL,
      PRIMARY KEY (date, channel)
    );

    CREATE TABLE IF NOT EXISTS eval_candidates (
      id TEXT PRIMARY KEY,
      trace_id TEXT NOT NULL,
      plan_snapshot_path TEXT,
      user_message_redacted TEXT,
      fail_reasons_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eval_candidates_status ON eval_candidates(status, created_at);
  `);
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

export function createAgentMetricsStore(dbPath = resolveWorkbenchSqlitePath()) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);
  migrateEvalCandidateColumns(db);

  return {
    hasTurnMetric(traceId: string): boolean {
      const row = db
        .prepare(`SELECT 1 AS ok FROM agent_turn_metrics WHERE trace_id = ? LIMIT 1`)
        .get(traceId) as { ok?: number } | undefined;
      return Boolean(row?.ok);
    },

    insertTurnMetric(input: AgentTurnMetricInput): string {
      const id = randomUUID();
      const now = input.occurredAt ?? new Date().toISOString();
      db.prepare(
        `INSERT INTO agent_turn_metrics (
          id, trace_id, user_id, channel, occurred_at, loop_ms, handler_ms, tool_calls,
          prompt_tokens, completion_tokens, has_draft, has_assignment, publish_ok,
          flags_json, quality_scores_json, outcome
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.traceId,
        input.userId,
        input.channel,
        now,
        input.loopMs ?? null,
        input.handlerMs ?? null,
        input.toolCalls ?? null,
        input.promptTokens ?? null,
        input.completionTokens ?? null,
        input.hasDraft ? 1 : 0,
        input.hasAssignment ? 1 : 0,
        input.publishOk ? 1 : 0,
        JSON.stringify(input.flags ?? []),
        input.qualityScores ? JSON.stringify(input.qualityScores) : null,
        input.outcome ?? null,
      );
      return id;
    },

    rollupDailyForDate(dateYmd: string): void {
      const rows = db
        .prepare(
          `SELECT channel, user_id, loop_ms, prompt_tokens, completion_tokens, flags_json
           FROM agent_turn_metrics
           WHERE occurred_at >= ? AND occurred_at < ?`,
        )
        .all(`${dateYmd}T00:00:00.000Z`, `${dateYmd}T23:59:59.999Z`) as Array<{
          channel: string;
          user_id: string;
          loop_ms: number | null;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          flags_json: string | null;
        }>;

      const byChannel = new Map<
        string,
        {
          users: Set<string>;
          turns: number;
          prompt: number;
          completion: number;
          loops: number[];
          incidents: Record<string, number>;
        }
      >();

      for (const row of rows) {
        const ch = row.channel || "unknown";
        if (!byChannel.has(ch)) {
          byChannel.set(ch, {
            users: new Set(),
            turns: 0,
            prompt: 0,
            completion: 0,
            loops: [],
            incidents: {},
          });
        }
        const agg = byChannel.get(ch)!;
        agg.users.add(row.user_id);
        agg.turns += 1;
        agg.prompt += Number(row.prompt_tokens ?? 0);
        agg.completion += Number(row.completion_tokens ?? 0);
        if (row.loop_ms != null) agg.loops.push(Number(row.loop_ms));
        try {
          const flags = JSON.parse(String(row.flags_json ?? "[]")) as string[];
          for (const f of flags) {
            agg.incidents[f] = (agg.incidents[f] ?? 0) + 1;
          }
        } catch {
          // ignore
        }
      }

      const upsert = db.prepare(
        `INSERT INTO agent_usage_daily (
          date, channel, active_users, turn_count, prompt_tokens, completion_tokens,
          avg_loop_ms, p90_loop_ms, incident_count_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date, channel) DO UPDATE SET
          active_users=excluded.active_users,
          turn_count=excluded.turn_count,
          prompt_tokens=excluded.prompt_tokens,
          completion_tokens=excluded.completion_tokens,
          avg_loop_ms=excluded.avg_loop_ms,
          p90_loop_ms=excluded.p90_loop_ms,
          incident_count_json=excluded.incident_count_json`,
      );

      for (const [channel, agg] of byChannel) {
        const avgLoop =
          agg.loops.length > 0 ? agg.loops.reduce((s, v) => s + v, 0) / agg.loops.length : 0;
        upsert.run(
          dateYmd,
          channel,
          agg.users.size,
          agg.turns,
          agg.prompt,
          agg.completion,
          avgLoop,
          percentile(agg.loops, 0.9),
          JSON.stringify(agg.incidents),
        );
      }
    },

    queryUsageDaily(fromYmd: string, toYmd: string): AgentUsageDailyRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM agent_usage_daily WHERE date >= ? AND date <= ? ORDER BY date ASC, channel ASC`,
        )
        .all(fromYmd, toYmd) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        date: String(r.date),
        channel: String(r.channel) as AgentMetricsChannel,
        activeUsers: Number(r.active_users),
        turnCount: Number(r.turn_count),
        promptTokens: Number(r.prompt_tokens),
        completionTokens: Number(r.completion_tokens),
        avgLoopMs: Number(r.avg_loop_ms),
        p90LoopMs: Number(r.p90_loop_ms),
        incidentCount: JSON.parse(String(r.incident_count_json ?? "{}")) as Record<string, number>,
      }));
    },

    queryTurnMetrics(fromIso: string, toIso: string, limit = 500): AgentTurnMetricInput[] {
      const rows = db
        .prepare(
          `SELECT * FROM agent_turn_metrics WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC LIMIT ?`,
        )
        .all(fromIso, toIso, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        traceId: String(r.trace_id),
        userId: String(r.user_id),
        channel: String(r.channel) as AgentMetricsChannel,
        occurredAt: String(r.occurred_at),
        loopMs: r.loop_ms != null ? Number(r.loop_ms) : undefined,
        handlerMs: r.handler_ms != null ? Number(r.handler_ms) : undefined,
        toolCalls: r.tool_calls != null ? Number(r.tool_calls) : undefined,
        promptTokens: r.prompt_tokens != null ? Number(r.prompt_tokens) : undefined,
        completionTokens: r.completion_tokens != null ? Number(r.completion_tokens) : undefined,
        hasDraft: Number(r.has_draft) === 1,
        hasAssignment: Number(r.has_assignment) === 1,
        publishOk: Number(r.publish_ok) === 1,
        flags: JSON.parse(String(r.flags_json ?? "[]")) as string[],
        qualityScores: r.quality_scores_json
          ? (JSON.parse(String(r.quality_scores_json)) as Record<string, unknown>)
          : undefined,
        outcome: r.outcome != null ? String(r.outcome) : undefined,
      }));
    },

    countDistinctUsers(fromIso: string, toIso: string): number {
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT user_id) AS c FROM agent_turn_metrics WHERE occurred_at >= ? AND occurred_at < ?`,
        )
        .get(fromIso, toIso) as { c: number };
      return Number(row?.c ?? 0);
    },

    insertEvalCandidate(input: {
      traceId: string;
      planSnapshotPath?: string;
      userMessageRedacted?: string;
      assistantMessageRedacted?: string;
      contextJson?: RedactedTurnContext[];
      ruleScoresJson?: Record<string, unknown>;
      judgeScoresJson?: Record<string, unknown>;
      failReasons: string[];
    }): string {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO eval_candidates (
          id, trace_id, plan_snapshot_path, user_message_redacted, assistant_message_redacted,
          context_json, rule_scores_json, judge_scores_json, fail_reasons_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        id,
        input.traceId,
        input.planSnapshotPath ?? null,
        input.userMessageRedacted ?? null,
        input.assistantMessageRedacted ?? null,
        input.contextJson ? JSON.stringify(input.contextJson) : null,
        input.ruleScoresJson ? JSON.stringify(input.ruleScoresJson) : null,
        input.judgeScoresJson ? JSON.stringify(input.judgeScoresJson) : null,
        JSON.stringify(input.failReasons),
        now,
        now,
      );
      return id;
    },

    listEvalCandidates(status: EvalCandidateRow["status"] = "pending", limit = 50): EvalCandidateRow[] {
      const rows = db
        .prepare(
          `SELECT * FROM eval_candidates WHERE status = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(status, limit) as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: String(r.id),
        traceId: String(r.trace_id),
        planSnapshotPath: r.plan_snapshot_path != null ? String(r.plan_snapshot_path) : undefined,
        userMessageRedacted:
          r.user_message_redacted != null ? String(r.user_message_redacted) : undefined,
        assistantMessageRedacted:
          r.assistant_message_redacted != null ? String(r.assistant_message_redacted) : undefined,
        contextJson: r.context_json
          ? (JSON.parse(String(r.context_json)) as RedactedTurnContext[])
          : undefined,
        ruleScoresJson: r.rule_scores_json
          ? (JSON.parse(String(r.rule_scores_json)) as Record<string, unknown>)
          : undefined,
        judgeScoresJson: r.judge_scores_json
          ? (JSON.parse(String(r.judge_scores_json)) as Record<string, unknown>)
          : undefined,
        failReasons: JSON.parse(String(r.fail_reasons_json ?? "[]")) as string[],
        status: String(r.status) as EvalCandidateRow["status"],
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      }));
    },

    queryQualitySummary(fromIso: string, toIso: string): {
      sampled: number;
      qualityFail: number;
      judgeFail: number;
      judgeScored: number;
    } {
      const rows = db
        .prepare(
          `SELECT outcome, quality_scores_json FROM agent_turn_metrics
           WHERE occurred_at >= ? AND occurred_at < ?`,
        )
        .all(fromIso, toIso) as Array<{ outcome: string | null; quality_scores_json: string | null }>;
      let sampled = 0;
      let qualityFail = 0;
      let judgeFail = 0;
      let judgeScored = 0;
      for (const row of rows) {
        if (row.outcome === "unsampled") continue;
        sampled += 1;
        if (row.outcome === "quality_fail") qualityFail += 1;
        if (!row.quality_scores_json) continue;
        try {
          const q = JSON.parse(row.quality_scores_json) as { judge?: { skipped?: boolean; overallPass?: boolean } };
          if (q.judge && q.judge.skipped !== true) {
            judgeScored += 1;
            if (q.judge.overallPass === false) judgeFail += 1;
          }
        } catch {
          // ignore
        }
      }
      return { sampled, qualityFail, judgeFail, judgeScored };
    },

    updateEvalCandidateStatus(id: string, status: EvalCandidateRow["status"]): void {
      db.prepare(`UPDATE eval_candidates SET status = ?, updated_at = ? WHERE id = ?`).run(
        status,
        new Date().toISOString(),
        id,
      );
    },
  };
}

export type AgentMetricsStore = ReturnType<typeof createAgentMetricsStore>;

let sharedStore: AgentMetricsStore | undefined;

export function getAgentMetricsStore(): AgentMetricsStore {
  if (!sharedStore) sharedStore = createAgentMetricsStore();
  return sharedStore;
}
