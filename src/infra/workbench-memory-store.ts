import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "./workbench-db-path";
import { redactCommonPii } from "./content-filter";

interface MemoryFactRow {
  content: string;
  score: number;
}

export function loadMemoryContextForPlan(planId: string): {
  summary?: string;
  facts: string[];
} {
  const normalizedPlanId = String(planId ?? "").trim();
  if (!normalizedPlanId) return { facts: [] };
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureTables(db);
    expireFacts(db, normalizedPlanId);
    const summaryRow = db
      .prepare("SELECT summary_text FROM memory_summaries WHERE plan_id = ?")
      .get(normalizedPlanId) as { summary_text?: string } | undefined;
    const factRows = db
      .prepare(
        `SELECT value_text AS content, confidence_score AS score
         FROM memory_facts
         WHERE plan_id = ? AND status = 'active' AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY confidence_score DESC, updated_at DESC
         LIMIT 8`,
      )
      .all(normalizedPlanId, new Date().toISOString()) as unknown as MemoryFactRow[];
    return {
      summary: typeof summaryRow?.summary_text === "string" ? summaryRow.summary_text : undefined,
      facts: factRows.map((r) => String(r.content ?? "").trim()).filter(Boolean),
    };
  } finally {
    db.close();
  }
}

export async function appendMemoryEvents(input: {
  planId: string;
  userMessage: string;
  assistantMessage: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  traceId?: string;
  modelConfig: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
  };
}): Promise<void> {
  const planId = String(input.planId ?? "").trim();
  if (!planId) return;
  const payload = await extractMemoryByModel(input);
  const dbPath = resolveWorkbenchSqlitePath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    ensureTables(db);
    const now = new Date().toISOString();
    if (payload.summary) {
      const summary = redactCommonPii(String(payload.summary));
      db.prepare(
        `INSERT INTO memory_summaries(plan_id, summary_text, updated_at)
         VALUES(?,?,?)
         ON CONFLICT(plan_id) DO UPDATE SET
           summary_text=excluded.summary_text,
           updated_at=excluded.updated_at`,
      ).run(planId, summary, now);
      appendMemoryEvent(db, {
        planId,
        eventType: "summary_updated",
        payload: { traceId: input.traceId ?? null },
      });
    }
    const insertFact = db.prepare(
      `INSERT INTO memory_facts(
        fact_id, plan_id, scope_type, scope_id, kind, value_text, source_type,
        confidence, confidence_score, status, dedupe_hash, created_at, updated_at, expires_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const deactivateByHash = db.prepare(
      "UPDATE memory_facts SET status='superseded', superseded_at=? WHERE plan_id=? AND dedupe_hash=? AND status='active'",
    );
    for (const fact of payload.facts.slice(0, 12)) {
      const value = redactCommonPii(String(fact.value ?? "").trim());
      if (!value) continue;
      const dedupeHash = hashFact(planId, fact.kind ?? "fact", value);
      const superseded = Number(deactivateByHash.run(now, planId, dedupeHash).changes ?? 0);
      if (superseded > 0) {
        appendMemoryEvent(db, {
          planId,
          eventType: "fact_superseded",
          payload: { dedupeHash, superseded },
        });
      }
      insertFact.run(
        randomUUID(),
        planId,
        "plan",
        planId,
        String(fact.kind ?? "fact"),
        value,
        String(fact.source ?? "assistant"),
        String(fact.confidence ?? "MEDIUM").toUpperCase(),
        toConfidenceScore(String(fact.confidence ?? "MEDIUM")),
        "active",
        dedupeHash,
        now,
        now,
        normalizeExpiresAt(fact.expiresAt),
      );
      appendMemoryEvent(db, {
        planId,
        eventType: "fact_upserted",
        payload: {
          kind: String(fact.kind ?? "fact"),
          confidence: String(fact.confidence ?? "MEDIUM").toUpperCase(),
          dedupeHash,
          traceId: input.traceId ?? null,
        },
      });
    }
  } finally {
    db.close();
  }
}

async function extractMemoryByModel(input: {
  planId: string;
  userMessage: string;
  assistantMessage: string;
  latestDraft?: Record<string, unknown>;
  latestAssignment?: Record<string, unknown>;
  traceId?: string;
  modelConfig: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
  };
}): Promise<{
  summary?: string;
  facts: Array<{
    kind?: string;
    value?: string;
    source?: string;
    confidence?: string;
    expiresAt?: string;
  }>;
}> {
  const model = String(process.env.MEMORY_EXTRACTION_MODEL ?? "qwen-doc-turbo").trim();
  const controller = new AbortController();
  const timeoutMs = Math.max(3000, Number(process.env.MEMORY_EXTRACTION_TIMEOUT_MS ?? input.modelConfig.timeoutMs));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${input.modelConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.modelConfig.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: Number(process.env.MEMORY_EXTRACTION_MAX_TOKENS ?? "800"),
        messages: [
          {
            role: "system",
            content: [
              "你是 memory 提取器。只返回 JSON，不要解释。",
              "输出结构：{ summary: string, facts: [{ kind, value, source, confidence, expiresAt? }] }",
              "facts 只保留稳定、可复用的信息。不得编造。",
              "若信息不足可返回空 facts。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              planId: input.planId,
              traceId: input.traceId ?? null,
              userMessage: input.userMessage,
              assistantMessage: input.assistantMessage,
              latestDraftSummary: summarizeDraft(input.latestDraft),
              latestAssignmentSummary: summarizeAssignment(input.latestAssignment),
            }),
          },
        ],
      }),
    });
    if (!resp.ok) {
      return { facts: [] };
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!raw) return { facts: [] };
    const normalized = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? raw;
    const parsed = JSON.parse(normalized) as {
      summary?: string;
      facts?: Array<Record<string, unknown>>;
    };
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : undefined,
      facts: Array.isArray(parsed.facts)
        ? parsed.facts.map((row) => ({
            kind: typeof row.kind === "string" ? row.kind : "fact",
            value: typeof row.value === "string" ? row.value : "",
            source: typeof row.source === "string" ? row.source : "assistant",
            confidence: typeof row.confidence === "string" ? row.confidence : "MEDIUM",
            expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
          }))
        : [],
    };
  } catch {
    return { facts: [] };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeDraft(draft?: Record<string, unknown>): Record<string, unknown> {
  const tasks = Array.isArray((draft as { tasks?: unknown[] } | undefined)?.tasks)
    ? ((draft as { tasks: Array<Record<string, unknown>> }).tasks)
    : [];
  return {
    hasDraft: !!draft,
    taskCount: tasks.length,
    taskIds: tasks.map((t) => String(t.id ?? "").trim()).filter(Boolean).slice(0, 12),
    taskTitles: tasks.map((t) => String(t.title ?? "").trim()).filter(Boolean).slice(0, 8),
  };
}

function summarizeAssignment(assignment?: Record<string, unknown>): Record<string, unknown> {
  const assignments = Array.isArray((assignment as { assignments?: unknown[] } | undefined)?.assignments)
    ? ((assignment as { assignments: Array<Record<string, unknown>> }).assignments)
    : [];
  return {
    hasAssignment: !!assignment,
    assignmentCount: assignments.length,
    taskIds: assignments.map((a) => String(a.taskId ?? "").trim()).filter(Boolean).slice(0, 12),
  };
}

function hashFact(planId: string, kind: string, value: string): string {
  return createHash("sha256")
    .update(`${planId}|${kind.toLowerCase()}|${value.toLowerCase()}`)
    .digest("hex");
}

function toConfidenceScore(confidence: string): number {
  const upper = confidence.toUpperCase();
  if (upper === "HIGH") return 1;
  if (upper === "LOW") return 0.3;
  return 0.7;
}

function ensureTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_summaries (
      plan_id TEXT PRIMARY KEY,
      summary_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_facts (
      fact_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      value_text TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence TEXT NOT NULL,
      confidence_score REAL NOT NULL DEFAULT 0.7,
      status TEXT NOT NULL DEFAULT 'active',
      dedupe_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      superseded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_memory_facts_plan ON memory_facts(plan_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_memory_facts_hash ON memory_facts(plan_id, dedupe_hash);
    CREATE TABLE IF NOT EXISTS memory_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      occurred_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_events_plan ON memory_events(plan_id, occurred_at);
  `);
}

function normalizeExpiresAt(raw: unknown): string | null {
  const parsed = String(raw ?? "").trim();
  if (parsed) return parsed;
  const days = Number(process.env.MEMORY_FACT_TTL_DAYS ?? "14");
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function expireFacts(db: DatabaseSync, planId: string): void {
  const now = new Date().toISOString();
  const changed = Number(
    db
      .prepare(
        "UPDATE memory_facts SET status='expired', updated_at=? WHERE plan_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at <= ?",
      )
      .run(now, planId, now).changes ?? 0,
  );
  if (changed > 0) {
    appendMemoryEvent(db, {
      planId,
      eventType: "fact_expired",
      payload: { count: changed },
    });
  }
}

function appendMemoryEvent(
  db: DatabaseSync,
  input: { planId: string; eventType: string; payload?: Record<string, unknown> },
): void {
  db.prepare(
    "INSERT INTO memory_events(plan_id, event_type, payload_json, occurred_at) VALUES(?,?,?,?)",
  ).run(
    input.planId,
    input.eventType,
    JSON.stringify(input.payload ?? {}),
    new Date().toISOString(),
  );
}
