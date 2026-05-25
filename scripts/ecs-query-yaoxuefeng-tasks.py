#!/usr/bin/env python3
import json
import sqlite3

DB = "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

for task_no in ["TASK-20260520-0003", "TASK-20260521-0004"]:
    print(f"\n=== {task_no} ===")
    t = db.execute("SELECT task_id, manager_user_id FROM tasks WHERE task_no=?", (task_no,)).fetchone()
    if not t:
        print("not found")
        continue
    subs = db.execute(
        "SELECT subtask_id, title, status, due_at, assignee_user_id FROM subtasks WHERE task_id=?",
        (t["task_id"],),
    ).fetchall()
    for s in subs:
        emp = db.execute("SELECT name FROM dingtalk_contacts WHERE user_id=?", (s["assignee_user_id"],)).fetchone()
        print(dict(s), "assignee:", emp["name"] if emp else s["assignee_user_id"])
        for e in db.execute(
            "SELECT occurred_at, event_type, actor_user_id, note FROM task_events WHERE subtask_id=? ORDER BY occurred_at",
            (s["subtask_id"],),
        ):
            print(" ", e["occurred_at"], e["event_type"], e["actor_user_id"], (e["note"] or "")[:60])

print("\n=== manager contact ===")
print(dict(db.execute("SELECT user_id,name FROM dingtalk_contacts WHERE user_id='641871342'").fetchone()))

print("\n=== SUBTASK_REMIND events for yaoxuefeng tasks ===")
for e in db.execute(
    """
    SELECT te.occurred_at, te.event_type, te.payload_json, t.task_no, s.title
      FROM task_events te
      JOIN subtasks s ON s.subtask_id=te.subtask_id
      JOIN tasks t ON t.task_id=s.task_id
     WHERE s.assignee_user_id='773919914' AND te.event_type LIKE '%REMIND%'
     ORDER BY te.occurred_at DESC
    """
):
    print(e["occurred_at"], e["task_no"], e["title"], e["event_type"], (e["payload_json"] or "")[:200])
