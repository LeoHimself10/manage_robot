#!/usr/bin/env python3
"""在 ECS 正式库插入一条已发布任务（子任务全给 T-developer1，主管姚凯珩）。"""
import json
import sqlite3
import sys
import uuid
from datetime import datetime, timedelta, timezone

DB = sys.argv[1] if len(sys.argv) > 1 else "/opt/manage_robot/data/workbench/workbench.sqlite"


def find_user(db, pattern):
    return db.execute(
        "SELECT user_id, name FROM dingtalk_contacts WHERE active=1 AND (name LIKE ? OR user_id LIKE ?) LIMIT 10",
        (f"%{pattern}%", f"%{pattern}%"),
    ).fetchall()


def main():
    db = sqlite3.connect(DB)
    mgr_rows = find_user(db, "姚凯")
    dev_rows = find_user(db, "developer1")
    manager_id = next((r[0] for r in mgr_rows if r[1] and "姚凯" in r[1]), None)
    if not manager_id and mgr_rows:
        manager_id = mgr_rows[0][0]
    assignee_id = dev_rows[0][0] if dev_rows else None
    if not manager_id or not assignee_id:
        print("mgr_rows", mgr_rows, "dev_rows", dev_rows)
        raise SystemExit("contact not found")

    plan_id = str(uuid.uuid4())
    task_id = f"task:{plan_id}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    due = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    task_no = f"W{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

    titles = [
        ("task_1", "收集与整理基础资料"),
        ("task_2", "执行主流程验证"),
        ("task_3", "输出结论与复盘"),
    ]

    db.execute(
        """INSERT INTO tasks (
             task_id, task_no, plan_id, title, description, status,
             initiator_user_id, initiator_department, manager_user_id,
             source_trace_id, published_at, created_at, updated_at
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            task_id,
            task_no,
            plan_id,
            "后台种子任务 · 子任务全指派验收",
            f"主管姚凯珩后台指派，全部子任务给 {dev_rows[0][1] or assignee_id}，用于工作台验收。",
            "ASSIGNED",
            manager_id,
            "管理部",
            manager_id,
            "seed-script",
            now,
            now,
            now,
        ),
    )

    subtask_ids = []
    for source_key, title in titles:
        sid = f"{task_id}:{source_key}"
        subtask_ids.append(sid)
        db.execute(
            """INSERT INTO subtasks (
                 subtask_id, task_id, source_task_key, title, assignee_user_id, status,
                 due_at, feedback_frequency, created_at, updated_at
               ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (sid, task_id, source_key, title, assignee_id, "ASSIGNED", due, "每周", now, now),
        )
        db.execute(
            """INSERT INTO task_events (task_id, subtask_id, event_type, actor_user_id, occurred_at, payload_json)
               VALUES (?, ?, 'TASK_PUBLISHED', ?, ?, ?)""",
            (
                task_id,
                sid,
                manager_id,
                now,
                json.dumps({"seed": True, "title": title}, ensure_ascii=False),
            ),
        )

    db.commit()
    mgr_name = next((r[1] for r in mgr_rows if r[0] == manager_id), manager_id)
    print(
        json.dumps(
            {
                "ok": True,
                "taskNo": task_no,
                "taskId": task_id,
                "planId": plan_id,
                "managerUserId": manager_id,
                "managerName": mgr_name,
                "assigneeUserId": assignee_id,
                "assigneeName": dev_rows[0][1],
                "subtaskCount": len(subtask_ids),
                "subtasks": subtask_ids,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
