#!/usr/bin/env python3
"""为五 projectView 写入短 label + filters.keyword（保留 legacy 成对字段）。"""
import json
import sys
from pathlib import Path

VIEW_PATCH = {
    "cla": {"label": "CLA", "keyword": "CLA"},
    "oct": {"label": "OCT", "keyword": "OCT"},
    "laser-shockwave": {"label": "冲击波", "keyword": "冲击波"},
    "large-vessel-plaque": {"label": "斑块减容", "keyword": "斑块减容"},
    "semiconductor-vein": {"label": "半导体", "keyword": "半导体"},
}

path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/daily-report-digest.config.json")
cfg = json.loads(path.read_text(encoding="utf-8"))
for org in cfg.get("orgs") or []:
    for pv in org.get("projectViews") or []:
        patch = VIEW_PATCH.get(pv.get("id"))
        if not patch:
            continue
        pv["label"] = patch["label"]
        pv.setdefault("filters", {})["keyword"] = patch["keyword"]
path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("patched label+keyword for", ", ".join(VIEW_PATCH.keys()))
