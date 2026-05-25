#!/usr/bin/env python3
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/opt/manage_robot/data/sessions/c2ee9b7419b9ff1c9f2e769e24ee0b76ea08ea4e6d95bc1574a80b84acddbdf9.json"
with open(path, encoding="utf-8") as f:
    s = json.load(f)
d = s.get("latestDraft") or {}
print("planId:", s.get("planId"))
print("stagedBy:", d.get("stagedBy"))
print("title:", (d.get("title") or "")[:80])
print("taskCount:", len(d.get("tasks") or []))
hist = s.get("conversationHistory") or []
print("historyTail:")
for h in hist[-4:]:
    role = h.get("role")
    content = str(h.get("content") or "")[:120].replace("\n", " ")
    print(f"  {role}: {content}")
