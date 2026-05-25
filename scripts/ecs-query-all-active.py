#!/usr/bin/env python3
import json
import sqlite3
from datetime import datetime, timezone

DB = "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

def parse_due(raw):
    if not raw or str(raw).strip() in ("", "待确认"):
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        pass
    from datetime import datetime as dt
    t = dt.fromisoformat(str(raw)) if "T" in str(raw) else dt.strptime(str(raw), "%Y-%m-%d")
    return t.replace(tzinfo=timezone.utc)

now = datetime.now(timezone.utc)
print("now UTC:", now.isoformat())

print("\n=== ALL active subtasks ===")
rows = db.execute(
    """
    SELECT t.task_no, t.manager_user_id, mgr.name manager_name,
           s.subtask_id, s.title, s.status, s.due_at, s.assignee_user_id, emp.name assignee_name
      FROM subtasks s
      JOIN tasks t ON t.task_id=s.task_id
      LEFT JOIN dingtalk_contacts emp ON emp.user_id=s.assignee_user_id
      LEFT JOIN dingtalk_contacts mgr ON mgr.user_id=t.manager_user_id
     WHERE s.status <> 'DONE'
     ORDER BY t.task_no, s.subtask_id
    """
).fetchall()
for r in rows:
    d = dict(r)
    due_dt = parse_due(d.get("due_at"))
    d["overdue"] = bool(due_dt and due_dt < now)
    d["eligible_for_scheduler"] = d["status"] in ("IN_PROGRESS", "BLOCKED") and d["overdue"]
    print(json.dumps(d, ensure_ascii=False))

print("\n=== progress_digest_state schema ===")
print(db.execute("PRAGMA table_info(progress_digest_state)").fetchall())
print(list(db.execute("SELECT * FROM progress_digest_state ORDER BY last_sent_at DESC LIMIT 10")))

print("\n=== manager 641871342 contact ===")
print(dict(db.execute("SELECT user_id,name,union_id FROM dingtalk_contacts WHERE user_id='641871342'").fetchone() or {}))

print("\n=== reminder events all ===")
for e in db.execute(
    "SELECT event_type, occurred_at, payload_json FROM task_events WHERE event_type LIKE '%REMIND%' ORDER BY occurred_at DESC LIMIT 20"
):
    print(dict(e))
