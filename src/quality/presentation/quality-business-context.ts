import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { resolveWorkbenchSqlitePath } from "../../infra/workbench-db-path";

type DatabaseRow = Record<string, unknown>;

export interface QualityBusinessContext {
  eventId: string;
  eventNo: string;
  eventTitle: string;
  eventSummary: string;
}

function hasTables(db: DatabaseSync, names: string[]): boolean {
  if (names.length === 0) return true;
  const rows = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN (${names.map(() => "?").join(",")})
  `).all(...names) as DatabaseRow[];
  return new Set(rows.map((row) => String(row.name))).size === names.length;
}

/**
 * Resolve the single quality-event business identity attached to each already-authorized
 * formal task. `tasks.task_no` remains the internal routing key; callers use `eventNo`
 * only as the user-facing business number.
 */
export function getQualityBusinessContextsByTaskIds(
  taskIds: string[],
  dbPath = resolveWorkbenchSqlitePath(),
): Map<string, QualityBusinessContext> {
  const ids = [...new Set(taskIds.map((id) => id.trim()).filter(Boolean))];
  const result = new Map<string, QualityBusinessContext>();
  if (ids.length === 0 || !existsSync(dbPath)) return result;

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const placeholders = ids.map(() => "?").join(",");
    const candidates: Array<DatabaseRow> = [];
    if (hasTables(db, [
      "quality_task_links",
      "quality_assignment_nodes",
      "quality_events",
    ])) {
      candidates.push(...db.prepare(`
        SELECT DISTINCT l.task_id,e.id AS event_id,e.event_no,e.title AS event_title,
               e.problem_status AS event_summary
        FROM quality_task_links l
        JOIN quality_assignment_nodes n ON n.node_id=l.node_id
        JOIN quality_events e ON e.id=n.event_id AND e.deleted_at IS NULL
        WHERE l.task_id IN (${placeholders})
      `).all(...ids) as DatabaseRow[]);
    }
    if (hasTables(db, ["quality_analysis_handoffs", "quality_events", "tasks"])) {
      candidates.push(...db.prepare(`
        SELECT DISTINCT t.task_id,e.id AS event_id,e.event_no,e.title AS event_title,
               e.problem_status AS event_summary
        FROM tasks t
        JOIN quality_analysis_handoffs h
          ON h.formal_task_id=t.task_id OR h.plan_id=t.plan_id
        JOIN quality_events e ON e.id=h.event_id AND e.deleted_at IS NULL
        WHERE t.task_id IN (${placeholders})
      `).all(...ids) as DatabaseRow[]);
    }

    const byTask = new Map<string, Map<string, QualityBusinessContext>>();
    for (const row of candidates) {
      const taskId = String(row.task_id ?? "").trim();
      const eventId = String(row.event_id ?? "").trim();
      const eventNo = String(row.event_no ?? "").trim();
      if (!taskId || !eventId || !eventNo) continue;
      const events = byTask.get(taskId) ?? new Map<string, QualityBusinessContext>();
      events.set(eventId, {
        eventId,
        eventNo,
        eventTitle: String(row.event_title ?? "").trim(),
        eventSummary: String(row.event_summary ?? "").trim(),
      });
      byTask.set(taskId, events);
    }
    for (const [taskId, events] of byTask) {
      if (events.size !== 1) continue;
      const context = events.values().next().value as QualityBusinessContext | undefined;
      if (context) result.set(taskId, context);
    }
    return result;
  } catch {
    return result;
  } finally {
    db.close();
  }
}
