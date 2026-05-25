#!/usr/bin/env python3
import json
import sqlite3

DB = "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

subtask_id = "task:aef200a2-0b8c-4acf-90ad-b547fd8fd3ac:task_1"
task_no = "TASK-20260521-0004"

print("=== task + subtask ===")
row = db.execute(
    """
    SELECT t.*, s.subtask_id, s.title subtask_title, s.status, s.due_at, s.assignee_user_id, s.updated_at
      FROM tasks t JOIN subtasks s ON s.task_id=t.task_id
     WHERE t.task_no=?
    """,
    (task_no,),
).fetchone()
print(json.dumps(dict(row), ensure_ascii=False, indent=2, default=str))

print("\n=== events ===")
for e in db.execute(
    """
    SELECT event_type, actor_user_id, note, payload_json, occurred_at
      FROM task_events WHERE subtask_id=? OR task_id=?
     ORDER BY occurred_at ASC
    """,
    (subtask_id, row["task_id"]),
):
    print(e["occurred_at"], e["event_type"], e["actor_user_id"], (e["note"] or "")[:80])

print("\n=== reminder state ===")
st = db.execute("SELECT * FROM subtask_reminder_state WHERE subtask_id=?", (subtask_id,)).fetchone()
print(dict(st) if st else None)

print("\n=== manager digest state ===")
for s in db.execute(
    "SELECT * FROM progress_digest_state WHERE user_id=? ORDER BY sent_on DESC LIMIT 10",
    (row["manager_user_id"],),
):
    print(dict(s))

print("\n=== all IN_PROGRESS/BLOCKED overdue ===")
for r in db.execute(
    """
    SELECT t.task_no, s.subtask_id, s.status, s.due_at, emp.name assignee, mgr.name manager
      FROM subtasks s
      JOIN tasks t ON t.task_id=s.task_id
      LEFT JOIN dingtalk_contacts emp ON emp.user_id=s.assignee_user_id
      LEFT JOIN dingtalk_contacts mgr ON mgr.user_id=t.manager_user_id
     WHERE s.status IN ('IN_PROGRESS','BLOCKED')
    """
):
    print(dict(r))
