import { DatabaseSync } from "node:sqlite";

const userId = process.argv[2]?.trim() || "624511819";
const dbPath = process.argv[3]?.trim() || "/app/data/workbench/workbench.sqlite";

const db = new DatabaseSync(dbPath);
const events = db
  .prepare(
    `SELECT event_type, actor_user_id, payload_json, occurred_at, note, subtask_id
     FROM task_events WHERE actor_user_id = ? AND occurred_at >= '2026-06-01'
     ORDER BY occurred_at DESC LIMIT 20`,
  )
  .all(userId);

const activity = db
  .prepare(
    `SELECT surface, kind, path, occurred_at FROM workbench_activity_events
     WHERE user_id = ? AND occurred_at >= '2026-06-01' ORDER BY occurred_at DESC LIMIT 20`,
  )
  .all(userId);

console.log(JSON.stringify({ userId, events, activity }, null, 2));
