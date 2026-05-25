#!/usr/bin/env python3
"""Query overdue tasks for 姚雪峰 and reminder/digest state on ECS."""
import json
import sqlite3
import sys
from datetime import datetime, timezone

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row

contacts = db.execute(
    "SELECT user_id, name, union_id FROM dingtalk_contacts WHERE name LIKE ? AND active=1",
    ("%姚雪峰%",),
).fetchall()
print("=== contacts ===")
print(json.dumps([dict(c) for c in contacts], ensure_ascii=False, indent=2))

if not contacts:
    sys.exit(0)

uids = [c["user_id"] for c in contacts]
print("user_ids:", uids)
placeholders = ",".join("?" * len(uids))
rows = db.execute(
    f"""
    SELECT t.task_no, t.title AS task_title, t.manager_user_id, mgr.name AS manager_name,
           s.subtask_id, s.title AS subtask_title, s.status, s.due_at, s.updated_at,
           s.assignee_user_id, emp.name AS assignee_name
      FROM subtasks s
      JOIN tasks t ON t.task_id = s.task_id
      LEFT JOIN dingtalk_contacts emp ON emp.user_id = s.assignee_user_id
      LEFT JOIN dingtalk_contacts mgr ON mgr.user_id = t.manager_user_id
     WHERE s.assignee_user_id IN ({placeholders})
        OR emp.name LIKE ?
     ORDER BY s.updated_at DESC
    """,
    (*uids, "%姚雪峰%"),
).fetchall()
print("\n=== subtasks ===")
now = datetime.now(timezone.utc)
for r in rows:
    d = dict(r)
    due = d.get("due_at")
    overdue = False
    if due:
        try:
            due_dt = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
            if due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
            overdue = due_dt < now
        except ValueError:
            pass
    d["is_overdue_now"] = overdue
    print(json.dumps(d, ensure_ascii=False))
    st = db.execute(
        "SELECT * FROM subtask_reminder_state WHERE subtask_id=?",
        (d["subtask_id"],),
    ).fetchone()
    if st:
        print("  reminder_state:", json.dumps(dict(st), ensure_ascii=False))
    events = db.execute(
        """
        SELECT event_type, occurred_at, payload FROM task_events
         WHERE subtask_id=? AND event_type LIKE '%REMIND%'
         ORDER BY occurred_at DESC LIMIT 8
        """,
        (d["subtask_id"],),
    ).fetchall()
    for e in events:
        print(
            "  event:",
            e["event_type"],
            e["occurred_at"],
            (e["payload"] or "")[:300],
        )

print("\n=== all overdue IN_PROGRESS/BLOCKED ===")
all_rows = db.execute(
    """
    SELECT t.task_no, t.title AS task_title, t.manager_user_id, mgr.name AS manager_name,
           s.subtask_id, s.title AS subtask_title, s.status, s.due_at,
           s.assignee_user_id, emp.name AS assignee_name
      FROM subtasks s
      JOIN tasks t ON t.task_id = s.task_id
      LEFT JOIN dingtalk_contacts emp ON emp.user_id = s.assignee_user_id
      LEFT JOIN dingtalk_contacts mgr ON mgr.user_id = t.manager_user_id
     WHERE s.status IN ('IN_PROGRESS','BLOCKED') AND s.due_at IS NOT NULL AND TRIM(s.due_at) <> ''
    """
).fetchall()
for r in all_rows:
    d = dict(r)
    due = d.get("due_at")
    try:
        due_dt = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
        if due_dt.tzinfo is None:
            due_dt = due_dt.replace(tzinfo=timezone.utc)
    except ValueError:
        continue
    if due_dt < now and ("姚雪峰" in (d.get("assignee_name") or "") or d.get("assignee_user_id") in uids):
        print(json.dumps(d, ensure_ascii=False))

print("\n=== progress_digest_state (manager if known) ===")
mgr_ids = {r["manager_user_id"] for r in rows if r["manager_user_id"]}
for mid in sorted(mgr_ids):
    states = db.execute(
        "SELECT * FROM progress_digest_state WHERE user_id=? ORDER BY sent_on DESC LIMIT 5",
        (mid,),
    ).fetchall()
    mgr_name = db.execute(
        "SELECT name FROM dingtalk_contacts WHERE user_id=?",
        (mid,),
    ).fetchone()
    print(
        mid,
        mgr_name["name"] if mgr_name else "?",
        [dict(s) for s in states],
    )
