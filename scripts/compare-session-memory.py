#!/usr/bin/env python3
import json
import sys

def summarize(path: str) -> dict:
    s = json.load(open(path, encoding="utf-8"))
    h = s.get("conversationHistory") or []
    return {
        "path": path,
        "conversationHistory": len(h),
        "knownFacts": len(s.get("knownFacts") or []),
        "taskScopes": len(s.get("taskScopes") or []),
        "revisionEvents": len(s.get("revisionEvents") or []),
        "has_latestDraft": bool(s.get("latestDraft")),
        "has_latestAssignment": bool(s.get("latestAssignment")),
        "history_roles": [m.get("role") for m in h],
    }

if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps(summarize(p), ensure_ascii=False, indent=2))
