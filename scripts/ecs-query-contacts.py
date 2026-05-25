#!/usr/bin/env python3
import sqlite3
import sys

db_path = sys.argv[1] if len(sys.argv) > 1 else "/opt/manage_robot/data/workbench/workbench.sqlite"
db = sqlite3.connect(db_path)
for pattern in ["姚凯", "developer", "T-developer", "641871342"]:
    rows = db.execute(
        "SELECT user_id, name FROM dingtalk_contacts WHERE active=1 AND (name LIKE ? OR user_id LIKE ?)",
        (f"%{pattern}%", f"%{pattern}%"),
    ).fetchall()
    print(pattern, "->", rows)
