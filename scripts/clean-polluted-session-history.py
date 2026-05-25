#!/usr/bin/env python3
"""Remove conversationHistory turns polluted with hallucinated OCT-2026-001 replies."""
import json
import shutil
import sys
import time

POLLUTION_MARKERS = [
    "OCT-2026-001",
    "OCT主机USB外设兼容性与数据导出稳定性优化专项",
]


def is_polluted_content(content: object) -> bool:
    text = str(content or "")
    return any(m in text for m in POLLUTION_MARKERS)


def clean_history(history: list) -> tuple[list, list]:
    removed = []
    kept = []
    i = 0
    while i < len(history):
        entry = history[i]
        role = entry.get("role")
        content = entry.get("content", "")

        if role == "assistant" and is_polluted_content(content):
            removed.append({"index": i, "role": role, "preview": str(content)[:80]})
            if (
                kept
                and kept[-1].get("role") == "user"
                and "已发布的任务" in str(kept[-1].get("content", ""))
            ):
                prev = kept.pop()
                removed.append(
                    {
                        "index": i - 1,
                        "role": "user",
                        "preview": str(prev.get("content", ""))[:80],
                    }
                )
            i += 1
            continue

        if (
            role == "user"
            and "已发布的任务" in str(content)
            and i + 1 < len(history)
            and history[i + 1].get("role") == "assistant"
            and is_polluted_content(history[i + 1].get("content"))
        ):
            removed.append({"index": i, "role": role, "preview": str(content)[:80]})
            i += 1
            continue

        kept.append(entry)
        i += 1

    return kept, removed


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: clean-polluted-session-history.py <session-json-path> [--dry-run]",
            file=sys.stderr,
        )
        return 1

    session_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    with open(session_path, encoding="utf-8") as f:
        session = json.load(f)

    history = session.get("conversationHistory") or []
    if not isinstance(history, list):
        history = []

    print("session:", session_path)
    print("planId:", session.get("planId"))
    print("history before:", len(history))

    kept, removed = clean_history(history)

    print("removed turns:", len(removed))
    for r in removed:
        preview = r["preview"].replace("\n", " ")
        print(f" - {r['role']} {preview}")
    print("history after:", len(kept))

    if not removed:
        print("Nothing to clean.")
        return 0

    if dry_run:
        print("Dry run — file not modified.")
        return 0

    backup_path = f"{session_path}.bak-{int(time.time())}"
    shutil.copy2(session_path, backup_path)
    print("backup:", backup_path)

    session["conversationHistory"] = kept
    with open(session_path, "w", encoding="utf-8") as f:
        json.dump(session, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
