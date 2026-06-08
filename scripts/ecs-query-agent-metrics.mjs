import { DatabaseSync } from "node:sqlite";

const userId = process.argv[2]?.trim() || "624511819";
const dbPath = process.argv[3]?.trim() || "/app/data/workbench/workbench.sqlite";

const db = new DatabaseSync(dbPath);
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%metric%'")
  .all();

let turns = [];
try {
  turns = db
    .prepare(
      `SELECT * FROM agent_turn_metrics WHERE user_id = ? AND created_at >= '2026-06-01' ORDER BY created_at DESC LIMIT 15`,
    )
    .all(userId);
} catch {
  // table may differ
}

let audit = [];
try {
  audit = db
    .prepare(
      `SELECT event_type, actor_user_id, payload_json, occurred_at FROM task_events
       WHERE actor_user_id = ? ORDER BY occurred_at DESC LIMIT 5`,
    )
    .all(userId);
} catch {
  // ignore
}

console.log(JSON.stringify({ tables, turns, recentEvents: audit }, null, 2));
