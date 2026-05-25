#!/usr/bin/env python3
"""List progress digest recipients from workbench SQLite."""
import json
import sqlite3
import sys

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(DB)
db.row_factory = sqlite3.Row


def name_of(uid: str) -> str | None:
    row = db.execute(
        "SELECT name FROM dingtalk_contacts WHERE user_id = ?",
        (uid,),
    ).fetchone()
    return row["name"] if row and row["name"] else None


def active_manager(uid: str) -> bool:
    row = db.execute(
        """
        SELECT 1 FROM tasks t
        JOIN subtasks s ON s.task_id = t.task_id
        WHERE t.manager_user_id = ? AND s.status <> 'DONE'
        LIMIT 1
        """,
        (uid,),
    ).fetchone()
    return row is not None


def active_employee(uid: str) -> bool:
    row = db.execute(
        "SELECT 1 FROM subtasks WHERE assignee_user_id = ? AND status <> 'DONE' LIMIT 1",
        (uid,),
    ).fetchone()
    return row is not None


managers = [
    r["uid"]
    for r in db.execute(
        "SELECT DISTINCT manager_user_id AS uid FROM tasks WHERE TRIM(manager_user_id) <> '' ORDER BY uid"
    )
]
employees = [
    r["uid"]
    for r in db.execute(
        "SELECT DISTINCT assignee_user_id AS uid FROM subtasks WHERE TRIM(assignee_user_id) <> '' ORDER BY uid"
    )
]
mgr_set = set(managers)
emp_set = set(employees)
all_uids = sorted(mgr_set | emp_set)

recipients = []
for uid in all_uids:
    is_mgr = uid in mgr_set
    is_emp = uid in emp_set
    if is_mgr and is_emp:
        audience = "combined"
    elif is_mgr:
        audience = "manager"
    else:
        audience = "employee"
    recipients.append(
        {
            "userId": uid,
            "name": name_of(uid),
            "audience": audience,
            "hasActiveWork": active_manager(uid) or active_employee(uid),
            "digestMode": "full" if (active_manager(uid) or active_employee(uid)) else "brief",
        }
    )

out = {
    "dbPath": DB,
    "totalRecipients": len(all_uids),
    "managerRoleCount": len(mgr_set),
    "employeeRoleCount": len(emp_set),
    "combinedRoleCount": len(mgr_set & emp_set),
    "fullDigestCount": sum(1 for r in recipients if r["digestMode"] == "full"),
    "briefDigestCount": sum(1 for r in recipients if r["digestMode"] == "brief"),
    "recipients": recipients,
}
print(json.dumps(out, ensure_ascii=False, indent=2))
