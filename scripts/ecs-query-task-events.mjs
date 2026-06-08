import { DatabaseSync } from "node:sqlite";

const taskNo = process.argv[2]?.trim() || "TASK-20260525-0001";
const dbPath = process.argv[3]?.trim() || "/app/data/workbench/workbench.sqlite";

const db = new DatabaseSync(dbPath);
const task = db
  .prepare("SELECT task_id, task_no, title, manager_user_id, updated_at FROM tasks WHERE task_no = ?")
  .get(taskNo);

if (!task) {
  console.log(JSON.stringify({ ok: false, error: "task_not_found", taskNo }));
  process.exit(0);
}

const events = db
  .prepare(
    `SELECT e.id, e.event_type, e.actor_user_id, e.subtask_id, e.note, e.payload_json, e.occurred_at,
            c.name AS actor_name, s.title AS subtask_title, s.assignee_user_id,
            ac.name AS assignee_name
     FROM task_events e
     LEFT JOIN dingtalk_contacts c ON c.user_id = e.actor_user_id
     LEFT JOIN subtasks s ON s.subtask_id = e.subtask_id
     LEFT JOIN dingtalk_contacts ac ON ac.user_id = s.assignee_user_id
     WHERE e.task_id = ?
     ORDER BY e.occurred_at DESC
     LIMIT 50`,
  )
  .all(task.task_id);

const aroundUpdate = events.filter((e) => {
  const t = String(e.occurred_at ?? "");
  return t.startsWith("2026-06-02") || t.startsWith("2026-06-01");
});

console.log(
  JSON.stringify(
    {
      ok: true,
      task,
      eventsToday: aroundUpdate,
      recentEvents: events.slice(0, 15),
    },
    null,
    2,
  ),
);
