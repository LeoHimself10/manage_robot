#!/usr/bin/env node
/**
 * Report duplicate active contact names and whether each user_id is referenced in tasks.
 * Usage: node scripts/dedupe-contacts-report.mjs [workbench.sqlite path]
 */
import { DatabaseSync } from "node:sqlite";

const dbPath = process.argv[2] || process.env.WORKBENCH_SQLITE_PATH?.trim() || "./data/workbench/workbench.sqlite";
const db = new DatabaseSync(dbPath);

const contacts = db
  .prepare("SELECT user_id, name, union_id, active, last_synced_at FROM dingtalk_contacts WHERE active = 1")
  .all();

const byName = new Map();
for (const row of contacts) {
  const name = String(row.name ?? "").trim();
  if (!name) continue;
  const list = byName.get(name) ?? [];
  list.push(row);
  byName.set(name, list);
}

const usedAsAssignee = db
  .prepare("SELECT DISTINCT assignee_user_id AS uid FROM subtasks")
  .all()
  .map((r) => String(r.uid ?? ""));
const usedAsManager = db
  .prepare("SELECT DISTINCT manager_user_id AS uid FROM tasks")
  .all()
  .map((r) => String(r.uid ?? ""));
const used = new Set([...usedAsAssignee, ...usedAsManager]);

const duplicates = [];
for (const [name, rows] of byName) {
  if (rows.length < 2) continue;
  duplicates.push({
    name,
    entries: rows.map((r) => ({
      userId: r.user_id,
      unionId: r.union_id,
      lastSyncedAt: r.last_synced_at,
      referencedInTasks: used.has(String(r.user_id)),
    })),
  });
}

console.log(JSON.stringify({ dbPath, duplicateNameCount: duplicates.length, duplicates }, null, 2));
