import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";
import { chineseBigramDice } from "./quality-similarity";

const DAY_MS = 24 * 60 * 60 * 1000;
const RULE_VERSION = "quality-candidate-v1";

export interface QualityCandidateConfig {
  windowDays: number;
  batchRepeatThreshold: number;
  modelCategoryThreshold: number;
  similarityThreshold: number;
  highRiskKeywords: string[];
}

export interface CandidateTrigger {
  code: "BATCH_REPEAT" | "MODEL_CATEGORY_REPEAT" | "HIGH_RISK_KEYWORD" | "HISTORY_SIMILAR";
  label: string;
  sourceKeys: string[];
  facts: Record<string, string | number>;
}

export interface CandidateDecision {
  kind: "QUALITY_CANDIDATE" | "DATA_INCOMPLETE" | "NONE";
  triggers: CandidateTrigger[];
  similarSourceKeys: string[];
  similarEventIds: string[];
}

export interface HistoricalQualityEvent {
  eventId: string;
  text: string;
  status: string;
}

function finiteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveQualityCandidateConfig(
  env: Record<string, string | undefined> = process.env,
): QualityCandidateConfig {
  return {
    windowDays: finiteNumber(env.QUALITY_CANDIDATE_WINDOW_DAYS, 30),
    batchRepeatThreshold: Math.max(2, Math.floor(finiteNumber(env.QUALITY_BATCH_REPEAT_THRESHOLD, 2))),
    modelCategoryThreshold: Math.max(2, Math.floor(finiteNumber(env.QUALITY_MODEL_CATEGORY_THRESHOLD, 3))),
    similarityThreshold: Math.min(1, finiteNumber(env.QUALITY_TEXT_SIMILARITY_THRESHOLD, 0.72)),
    highRiskKeywords: String(
      env.QUALITY_HIGH_RISK_KEYWORDS ?? "断裂,无法使用,术中异常,无法成像",
    ).split(/[,，]/).map((item) => item.trim()).filter(Boolean),
  };
}

function timestamp(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Date.parse(value.replace(/\//g, "-"));
  return Number.isFinite(parsed) ? parsed : null;
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

export function detectQualityCandidate(input: {
  row: NormalizedQualitySourceRow;
  recentRows: NormalizedQualitySourceRow[];
  historicalEvents: HistoricalQualityEvent[];
  config?: QualityCandidateConfig;
}): CandidateDecision {
  const config = input.config ?? resolveQualityCandidateConfig();
  const rowTime = timestamp(input.row.feedbackAt);
  if (rowTime == null || !input.row.issueDescription.trim()) {
    return { kind: "DATA_INCOMPLETE", triggers: [], similarSourceKeys: [], similarEventIds: [] };
  }
  const inWindow = input.recentRows.filter((candidate) => {
    const candidateTime = timestamp(candidate.feedbackAt);
    return candidateTime != null
      && Math.abs(candidateTime - rowTime) <= config.windowDays * DAY_MS;
  });
  const triggers: CandidateTrigger[] = [];

  if (input.row.catheterBatch) {
    const sameBatch = inWindow.filter((candidate) =>
      candidate.catheterBatch === input.row.catheterBatch
      && chineseBigramDice(candidate.issueDescription, input.row.issueDescription)
        >= config.similarityThreshold,
    );
    if (sameBatch.length >= config.batchRepeatThreshold) {
      const sourceKeys = sortedUnique(sameBatch.map((candidate) => candidate.sourceKey));
      triggers.push({
        code: "BATCH_REPEAT",
        label: "同批次相似问题重复出现",
        sourceKeys,
        facts: {
          batch: input.row.catheterBatch,
          count: sourceKeys.length,
          windowDays: config.windowDays,
        },
      });
    }
  }

  if (input.row.deviceModel && input.row.category) {
    const sameModelCategory = inWindow.filter((candidate) =>
      candidate.deviceModel === input.row.deviceModel
      && candidate.category === input.row.category,
    );
    if (sameModelCategory.length >= config.modelCategoryThreshold) {
      const sourceKeys = sortedUnique(sameModelCategory.map((candidate) => candidate.sourceKey));
      triggers.push({
        code: "MODEL_CATEGORY_REPEAT",
        label: "同型号同类问题重复出现",
        sourceKeys,
        facts: {
          deviceModel: input.row.deviceModel,
          category: input.row.category,
          count: sourceKeys.length,
          windowDays: config.windowDays,
        },
      });
    }
  }

  const matchedKeywords = config.highRiskKeywords.filter((keyword) =>
    input.row.issueDescription.includes(keyword),
  );
  if (matchedKeywords.length > 0) {
    triggers.push({
      code: "HIGH_RISK_KEYWORD",
      label: "问题描述包含高风险词",
      sourceKeys: [input.row.sourceKey],
      facts: { keywords: matchedKeywords.join("、") },
    });
  }

  const similarHistory = input.historicalEvents.filter((event) =>
    chineseBigramDice(event.text, input.row.issueDescription) >= config.similarityThreshold,
  );
  if (similarHistory.length > 0) {
    triggers.push({
      code: "HISTORY_SIMILAR",
      label: "与历史质量事件高度相似",
      sourceKeys: [input.row.sourceKey],
      facts: {
        count: similarHistory.length,
        threshold: config.similarityThreshold,
      },
    });
  }

  return {
    kind: triggers.length > 0 ? "QUALITY_CANDIDATE" : "NONE",
    triggers,
    similarSourceKeys: sortedUnique(triggers.flatMap((trigger) => trigger.sourceKeys)
      .filter((sourceKey) => sourceKey !== input.row.sourceKey)),
    similarEventIds: sortedUnique(similarHistory.map((event) => event.eventId)),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function transaction<T>(db: DatabaseSync, operation: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type DatabaseRow = Record<string, unknown>;

interface DetectedCandidate {
  id: string;
  candidateType: "ANOMALY" | "DATA_INCOMPLETE";
  sourceKeys: string[];
  ruleCodes: string[];
  explanation: Record<string, unknown>;
  sourceSummaryHash: string;
}

function detectAll(
  rows: NormalizedQualitySourceRow[],
  history: HistoricalQualityEvent[],
  config: QualityCandidateConfig,
): DetectedCandidate[] {
  const byId = new Map<string, DetectedCandidate>();
  const contentHashes = new Map(rows.map((row) => [row.sourceKey, row.contentHash]));
  for (const row of rows) {
    const decision = detectQualityCandidate({ row, recentRows: rows, historicalEvents: history, config });
    if (decision.kind === "NONE") continue;
    const sourceKeys = decision.kind === "DATA_INCOMPLETE"
      ? [row.sourceKey]
      : sortedUnique([row.sourceKey, ...decision.triggers.flatMap((trigger) => trigger.sourceKeys)]);
    const ruleCodes = decision.kind === "DATA_INCOMPLETE"
      ? ["DATA_INCOMPLETE"]
      : sortedUnique(decision.triggers.map((trigger) => trigger.code));
    const id = sha256([RULE_VERSION, decision.kind, sourceKeys.join(","), ruleCodes.join(",")].join("|"));
    const sourceSummaryHash = sha256(sourceKeys
      .map((sourceKey) => `${sourceKey}:${contentHashes.get(sourceKey) ?? ""}`)
      .join("|"));
    byId.set(id, {
      id,
      candidateType: decision.kind === "DATA_INCOMPLETE" ? "DATA_INCOMPLETE" : "ANOMALY",
      sourceKeys,
      ruleCodes,
      sourceSummaryHash,
      explanation: { ruleVersion: RULE_VERSION, sourceSummaryHash, decision, previousDecisions: [] },
    });
  }
  return [...byId.values()];
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? "{}")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function refreshQualityCandidates(input?: {
  dbPath?: string;
  env?: Record<string, string | undefined>;
  now?: () => string;
}): { inserted: number; updated: number; reopened: number; unchanged: number } {
  const db = new DatabaseSync(input?.dbPath ?? resolveWorkbenchSqlitePath());
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  const now = input?.now ?? (() => new Date().toISOString());
  try {
    const rows = (db.prepare(`
      SELECT source_key, content_hash, normalized_json
      FROM quality_source_rows WHERE state <> 'DELETED'
    `).all() as DatabaseRow[]).map((row) => ({
      ...(parseObject(row.normalized_json) as unknown as NormalizedQualitySourceRow),
      sourceKey: String(row.source_key),
      contentHash: String(row.content_hash),
    }));
    const history = (db.prepare(`
      SELECT id, status, title, problem_status
      FROM quality_events WHERE status <> 'DRAFT' AND COALESCE(is_test,0) = 0
    `).all() as DatabaseRow[]).map((row) => ({
      eventId: String(row.id),
      status: String(row.status),
      text: `${String(row.title)} ${String(row.problem_status)}`,
    }));
    const detected = detectAll(rows, history, resolveQualityCandidateConfig(input?.env));
    const occurredAt = now();

    return transaction(db, () => {
      let inserted = 0;
      let updated = 0;
      let reopened = 0;
      let unchanged = 0;
      for (const candidate of detected) {
        const existing = db.prepare(
          "SELECT * FROM quality_candidates WHERE id = ?",
        ).get(candidate.id) as DatabaseRow | undefined;
        if (!existing) {
          db.prepare(`
            INSERT INTO quality_candidates (
              id, candidate_type, status, score, rule_codes_json, source_keys_json,
              explanation_json, detected_at, version, created_at, updated_at
            ) VALUES (?, ?, 'OPEN', NULL, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            candidate.id,
            candidate.candidateType,
            JSON.stringify(candidate.ruleCodes),
            JSON.stringify(candidate.sourceKeys),
            JSON.stringify(candidate.explanation),
            occurredAt,
            occurredAt,
            occurredAt,
          );
          inserted += 1;
          continue;
        }

        const previousExplanation = parseObject(existing.explanation_json);
        const sourceChanged = previousExplanation.sourceSummaryHash !== candidate.sourceSummaryHash;
        if (String(existing.status) === "DISMISSED" && !sourceChanged) {
          unchanged += 1;
          continue;
        }
        if (String(existing.status) === "DISMISSED" && sourceChanged) {
          const previousDecisions = Array.isArray(previousExplanation.previousDecisions)
            ? [...previousExplanation.previousDecisions]
            : [];
          previousDecisions.push({
            decidedBy: existing.decided_by == null ? null : String(existing.decided_by),
            decidedAt: existing.decided_at == null ? null : String(existing.decided_at),
            reason: existing.decision_reason == null ? null : String(existing.decision_reason),
          });
          db.prepare(`
            UPDATE quality_candidates SET
              status = 'OPEN', candidate_type = ?, rule_codes_json = ?, source_keys_json = ?,
              explanation_json = ?, decided_by = NULL, decided_at = NULL,
              decision_reason = NULL, version = version + 1, updated_at = ?
            WHERE id = ?
          `).run(
            candidate.candidateType,
            JSON.stringify(candidate.ruleCodes),
            JSON.stringify(candidate.sourceKeys),
            JSON.stringify({ ...candidate.explanation, previousDecisions }),
            occurredAt,
            candidate.id,
          );
          reopened += 1;
          continue;
        }
        if (!sourceChanged || String(existing.status) === "REPORTED") {
          unchanged += 1;
          continue;
        }
        db.prepare(`
          UPDATE quality_candidates SET
            candidate_type = ?, rule_codes_json = ?, source_keys_json = ?,
            explanation_json = ?, version = version + 1, updated_at = ?
          WHERE id = ?
        `).run(
          candidate.candidateType,
          JSON.stringify(candidate.ruleCodes),
          JSON.stringify(candidate.sourceKeys),
          JSON.stringify({
            ...candidate.explanation,
            previousDecisions: Array.isArray(previousExplanation.previousDecisions)
              ? previousExplanation.previousDecisions
              : [],
          }),
          occurredAt,
          candidate.id,
        );
        updated += 1;
      }
      return { inserted, updated, reopened, unchanged };
    });
  } finally {
    db.close();
  }
}

