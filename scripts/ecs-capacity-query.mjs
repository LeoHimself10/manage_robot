import { DatabaseSync } from "node:sqlite";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dbPath = process.argv[2]?.trim() || "/app/data/workbench/workbench.sqlite";
const sessionsDir = process.argv[3]?.trim() || "/app/data/sessions";

const db = new DatabaseSync(dbPath);
const one = (sql) => db.prepare(sql).get();
const all = (sql) => db.prepare(sql).all();

function countSessionFiles(dir) {
  let n = 0;
  try {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) n += countSessionFiles(p);
      else if (ent.isFile()) n += 1;
    }
  } catch {
    // ignore
  }
  return n;
}

let walBytes = 0;
try {
  walBytes = statSync(`${dbPath}-wal`).size;
} catch {
  // no wal
}

console.log(
  JSON.stringify(
    {
      dbPath,
      dbBytes: statSync(dbPath).size,
      walBytes,
      tasks: one("SELECT COUNT(*) AS n FROM tasks").n,
      subtasks: one("SELECT COUNT(*) AS n FROM subtasks").n,
      taskEvents: one("SELECT COUNT(*) AS n FROM task_events").n,
      contactsActive: one("SELECT COUNT(*) AS n FROM dingtalk_contacts WHERE active=1").n,
      agentMetrics: one("SELECT COUNT(*) AS n FROM agent_turn_metrics").n,
      memoryFacts: one("SELECT COUNT(*) AS n FROM memory_facts").n,
      distinctManagers: one("SELECT COUNT(DISTINCT manager_user_id) AS n FROM tasks").n,
      distinctAssignees: one("SELECT COUNT(DISTINCT assignee_user_id) AS n FROM subtasks").n,
      subtasksByStatus: all("SELECT status, COUNT(*) AS n FROM subtasks GROUP BY status"),
      sessionFiles: countSessionFiles(sessionsDir),
    },
    null,
    2,
  ),
);
