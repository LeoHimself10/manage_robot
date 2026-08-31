import { DatabaseSync } from "node:sqlite";
import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

type DatabaseRow = Record<string, unknown>;

export interface QualityPlanningDraftContext {
  qualityTaskPackage: Record<string, unknown>;
  qualityHandoff: {
    integrationKey: string;
    qualityEventId: string;
    analysisVersion: number;
    requiredDeliverableIds: string[];
  };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(String(value ?? "")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function requiredDeliverableIds(taskPackage: Record<string, unknown>): string[] {
  if (!Array.isArray(taskPackage.requiredDeliverables)) return [];
  return taskPackage.requiredDeliverables
    .map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? String((item as Record<string, unknown>).deliverableId ?? "").trim()
      : "")
    .filter(Boolean);
}

/**
 * Recovers immutable quality-planning metadata from the authoritative handoff.
 *
 * Older side-thread redrafts could replace latestDraft with only title/tasks.
 * The handoff row remains authoritative, so the manager workbench can restore
 * quality-only controls without guessing from a title, label, or chat text.
 */
export function getQualityPlanningDraftContext(input: {
  planId: string;
  threadId: string;
  managerUserId: string;
  dbPath?: string;
}): QualityPlanningDraftContext | null {
  const planId = input.planId.trim();
  const threadId = input.threadId.trim();
  const managerUserId = input.managerUserId.trim();
  if (!planId || !threadId || !managerUserId) return null;

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(input.dbPath ?? resolveWorkbenchSqlitePath(), { readOnly: true });
    const table = db.prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='quality_analysis_handoffs'",
    ).get();
    if (!table) return null;
    const row = db.prepare(`SELECT event_id,analysis_version,integration_key,task_package_json
      FROM quality_analysis_handoffs
      WHERE plan_id=? AND thread_id=? AND primary_manager_user_id=? AND status='PENDING_PLANNING'
      ORDER BY created_at DESC LIMIT 1`).get(
      planId,
      threadId,
      managerUserId,
    ) as DatabaseRow | undefined;
    if (!row) return null;
    const taskPackage = parseObject(row.task_package_json);
    if (!taskPackage) return null;
    const qualityEventId = String(row.event_id ?? "").trim();
    const integrationKey = String(row.integration_key ?? "").trim();
    const analysisVersion = Number(row.analysis_version ?? 0);
    if (!qualityEventId || !integrationKey || !Number.isInteger(analysisVersion) || analysisVersion < 1) {
      return null;
    }
    return {
      qualityTaskPackage: taskPackage,
      qualityHandoff: {
        integrationKey,
        qualityEventId,
        analysisVersion,
        requiredDeliverableIds: requiredDeliverableIds(taskPackage),
      },
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}
