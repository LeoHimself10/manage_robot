import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";
import { createQualityStore } from "../infra/quality-store";
import type { QualitySourceReviewStatus } from "../reviews/quality-source-review-service";
import type { NormalizedQualitySourceRow } from "../source/quality-source-schema";

type DatabaseRow = Record<string, unknown>;

export type QualityReviewScope = "UNREVIEWED" | "NEEDS_INFO" | "COMPLETED";
export type QualityReviewRiskFilter = "ALL" | "HIGH_RISK" | "REPEAT" | "NONE";

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

function parseArray(value: unknown): unknown[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nullable(value: unknown): string | null {
  return value == null ? null : String(value);
}

function positiveInt(value: number | undefined, fallback: number, max: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Math.min(Number(value), max) : fallback;
}

function timestamp(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const normalized = text.replace(/[./]/g, "-");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sixMonthCutoff(now: Date): number {
  const cutoff = new Date(now.getTime());
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return cutoff.getTime();
}

function triggerList(explanation: Record<string, unknown>): Array<Record<string, unknown>> {
  const decision = explanation.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) return [];
  const triggers = (decision as Record<string, unknown>).triggers;
  return Array.isArray(triggers)
    ? triggers.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function createQualityReviewQuery(deps?: {
  dbPath?: string;
  now?: () => Date;
}) {
  const dbPath = deps?.dbPath ?? resolveWorkbenchSqlitePath();
  createQualityStore(dbPath).close();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const now = deps?.now ?? (() => new Date());

  function list(input?: {
    scope?: QualityReviewScope;
    q?: string;
    risk?: QualityReviewRiskFilter;
    deviceModel?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) {
    const scope = input?.scope ?? "UNREVIEWED";
    const riskFilter = input?.risk ?? "ALL";
    const query = String(input?.q ?? "").trim().toLocaleLowerCase("zh-CN");
    const deviceModel = String(input?.deviceModel ?? "").trim();
    const category = String(input?.category ?? "").trim();
    const page = positiveInt(input?.page, 1, 1_000_000);
    const pageSize = positiveInt(input?.pageSize, 50, 200);
    const cutoff = sixMonthCutoff(now());

    const rows = db.prepare(`
      SELECT r.*,v.status AS review_status,v.note AS review_note,v.decided_by,
             v.decided_at,v.source_content_hash AS reviewed_content_hash,v.event_id,
             v.version AS review_version,v.created_at AS review_created_at,
             v.updated_at AS review_updated_at
      FROM quality_source_rows r
      LEFT JOIN quality_source_reviews v ON v.source_key=r.source_key
      WHERE r.state<>'DELETED'
    `).all() as DatabaseRow[];

    const candidateRows = db.prepare(`
      SELECT candidate_type,status,rule_codes_json,source_keys_json,explanation_json,detected_at
      FROM quality_candidates
    `).all() as DatabaseRow[];
    const candidateBySource = new Map<string, Array<Record<string, unknown>>>();
    for (const candidate of candidateRows) {
      const ruleCodes = parseArray(candidate.rule_codes_json).map(String);
      const explanation = parseObject(candidate.explanation_json);
      const summary = {
        candidateType: String(candidate.candidate_type),
        status: String(candidate.status),
        ruleCodes,
        triggers: triggerList(explanation),
        sourceKeys: parseArray(candidate.source_keys_json).map(String),
        detectedAt: String(candidate.detected_at),
      };
      for (const sourceKey of summary.sourceKeys) {
        const list = candidateBySource.get(sourceKey) ?? [];
        list.push(summary);
        candidateBySource.set(sourceKey, list);
      }
    }

    const sourceSummary = new Map(rows.map((row) => {
      const normalized = parseObject(row.normalized_json) as unknown as NormalizedQualitySourceRow;
      return [String(row.source_key), {
        sourceKey: String(row.source_key),
        feedbackNo: String(normalized.feedbackNo ?? ""),
        feedbackAt: String(normalized.feedbackAt ?? ""),
        deviceModel: String(normalized.deviceModel ?? ""),
        category: String(normalized.category ?? ""),
        issueDescription: String(normalized.issueDescription ?? ""),
      }];
    }));

    const latestWritebacks = new Map<string, Record<string, unknown>>();
    const writebacks = db.prepare(`
      SELECT * FROM quality_source_writeback_outbox
      ORDER BY source_key,review_version DESC,created_at DESC
    `).all() as DatabaseRow[];
    for (const writeback of writebacks) {
      const key = String(writeback.source_key);
      if (!latestWritebacks.has(key)) latestWritebacks.set(key, writeback);
    }

    const eligible = rows.flatMap((row) => {
      const normalized = parseObject(row.normalized_json) as unknown as NormalizedQualitySourceRow;
      const feedbackTimestamp = timestamp(normalized.feedbackAt);
      if (feedbackTimestamp == null || feedbackTimestamp < cutoff) return [];
      const reviewStatus = row.review_status == null ? "UNREVIEWED" : String(row.review_status);
      const candidates = candidateBySource.get(String(row.source_key)) ?? [];
      const ruleCodes = [...new Set(candidates.flatMap((candidate) => candidate.ruleCodes as string[]))];
      const highRisk = ruleCodes.includes("HIGH_RISK_KEYWORD");
      const repeat = ruleCodes.some((code) => ["BATCH_REPEAT", "MODEL_CATEGORY_REPEAT", "HISTORY_SIMILAR"].includes(code));
      const relatedSourceKeys = [...new Set(candidates.flatMap((candidate) => candidate.sourceKeys as string[]))]
        .filter((sourceKey) => sourceKey !== String(row.source_key));
      const writeback = latestWritebacks.get(String(row.source_key));
      return [{
        ...normalized,
        sourceKey: String(row.source_key),
        rowNumber: Number(row.row_number),
        sourceState: String(row.state),
        sourceVersion: Number(row.source_version),
        sourceContentHash: String(row.content_hash),
        rawSnapshot: parseObject(row.raw_snapshot_json),
        feedbackTimestamp,
        risk: {
          highRisk,
          repeat,
          ruleCodes,
          triggers: candidates.flatMap((candidate) => candidate.triggers as Array<Record<string, unknown>>),
        },
        relatedFeedback: relatedSourceKeys.map((sourceKey) => sourceSummary.get(sourceKey)).filter(Boolean),
        review: {
          status: reviewStatus as "UNREVIEWED" | QualitySourceReviewStatus,
          note: nullable(row.review_note),
          decidedBy: nullable(row.decided_by),
          decidedAt: nullable(row.decided_at),
          eventId: nullable(row.event_id),
          version: row.review_version == null ? 0 : Number(row.review_version),
        },
        sourceUpdatedSinceDecision: reviewStatus === "NEEDS_INFO"
          && row.reviewed_content_hash != null
          && String(row.reviewed_content_hash) !== String(row.content_hash),
        writeback: writeback ? {
          status: String(writeback.status),
          desiredValue: String(writeback.desired_value),
          attemptCount: Number(writeback.attempt_count),
          lastError: nullable(writeback.last_error),
          updatedAt: String(writeback.updated_at),
        } : null,
      }];
    });

    const matchesScope = (status: string) => scope === "UNREVIEWED"
      ? status === "UNREVIEWED"
      : scope === "NEEDS_INFO"
        ? status === "NEEDS_INFO"
        : status === "ORDINARY" || status === "REPORTED";
    const matchesRisk = (item: (typeof eligible)[number]) => riskFilter === "ALL"
      || (riskFilter === "HIGH_RISK" && item.risk.highRisk)
      || (riskFilter === "REPEAT" && item.risk.repeat)
      || (riskFilter === "NONE" && !item.risk.highRisk && !item.risk.repeat);
    const filtered = eligible.filter((item) => {
      if (!matchesScope(item.review.status)) return false;
      if (!matchesRisk(item)) return false;
      if (deviceModel && String(item.deviceModel ?? "") !== deviceModel) return false;
      if (category && String(item.category ?? "") !== category) return false;
      if (!query) return true;
      return [item.feedbackNo, item.reporter, item.deviceModel, item.serialNo, item.catheterBatch, item.issueDescription, item.category]
        .some((value) => String(value ?? "").toLocaleLowerCase("zh-CN").includes(query));
    }).sort((a, b) => {
      const riskA = a.risk.highRisk ? 2 : a.risk.repeat ? 1 : 0;
      const riskB = b.risk.highRisk ? 2 : b.risk.repeat ? 1 : 0;
      return riskB - riskA || b.feedbackTimestamp - a.feedbackTimestamp || a.sourceKey.localeCompare(b.sourceKey);
    });
    const start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize).map(({ feedbackTimestamp: _feedbackTimestamp, ...item }) => item),
      pagination: {
        page,
        pageSize,
        total: filtered.length,
        pageCount: Math.ceil(filtered.length / pageSize),
      },
      stats: {
        unreviewed: eligible.filter((item) => item.review.status === "UNREVIEWED").length,
        needsInfo: eligible.filter((item) => item.review.status === "NEEDS_INFO").length,
        completed: eligible.filter((item) => ["ORDINARY", "REPORTED"].includes(item.review.status)).length,
        highRisk: eligible.filter((item) => item.review.status === "UNREVIEWED" && item.risk.highRisk).length,
        repeat: eligible.filter((item) => item.review.status === "UNREVIEWED" && item.risk.repeat).length,
        sourceUpdated: eligible.filter((item) => item.sourceUpdatedSinceDecision).length,
      },
      filters: {
        deviceModels: [...new Set(eligible.map((item) => String(item.deviceModel ?? "")).filter(Boolean))].sort(),
        categories: [...new Set(eligible.map((item) => String(item.category ?? "")).filter(Boolean))].sort(),
      },
    };
  }

  return { list, close: () => db.close() };
}
