#!/usr/bin/env python3
import sqlite3
DB = "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row
print("IN_PROGRESS/BLOCKED count:", db.execute("SELECT count(*) c FROM subtasks WHERE status IN ('IN_PROGRESS','BLOCKED')").fetchone()["c"])
for r in db.execute("""
  SELECT t.task_no, s.subtask_id, s.status, s.due_at, emp.name assignee
    FROM subtasks s JOIN tasks t ON t.task_id=s.task_id
    LEFT JOIN dingtalk_contacts emp ON emp.user_id=s.assignee_user_id
   WHERE s.status IN ('IN_PROGRESS','BLOCKED')
"""):
    print(dict(r))
print("reminder_state:", [dict(x) for x in db.execute("SELECT * FROM subtask_reminder_state")])
print("digest_state:", [dict(x) for x in db.execute("SELECT * FROM progress_digest_state")])
