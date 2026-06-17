#!/usr/bin/env python3
"""Patch managebot 微光 projectViews. See ecs-patch-project-view.mjs."""
import json
import os
import sys
from pathlib import Path

CONFIG_PATH = os.environ.get(
    "DAILY_REPORT_DIGEST_CONFIG_FILE",
    "/opt/manage_robot/data/daily-report-digest.config.json",
)
FALLBACK = os.environ.get(
    "MINGSIBOT_CONFIG_FALLBACK",
    "/opt/manage_robot-mingsibot/data/daily-report-digest.config.json",
)
ORG_LABEL = "微光"

VIEW = {
    "id": "semiconductor-vein",
    "label": "半导体激光·静脉项目",
    "viewers": ["01451725613871", "641871342"],
    "exclusiveForViewers": True,
    "discoveryDays": 30,
    "filters": {
        "workModuleContains": "半导体激光",
        "costProjectContains": "静脉腔内闭合系统",
    },
    "digest": {
        "enabled": True,
        "sendHour": 8,
        "sendMinute": 0,
    },
}


def load_or_bootstrap() -> dict:
    path = Path(CONFIG_PATH)
    if path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    fb = Path(FALLBACK)
    if not fb.is_file():
        print(f"config missing: {CONFIG_PATH} and no fallback {FALLBACK}", file=sys.stderr)
        sys.exit(1)
    src = json.loads(fb.read_text(encoding="utf-8"))
    weiguang = next((o for o in src.get("orgs") or [] if o.get("label") == ORG_LABEL), None)
    if not weiguang:
        print("微光 org not found in fallback", file=sys.stderr)
        sys.exit(1)
    print("[bootstrap] creating managebot config from mingsibot 微光 org (no legacy employees)")
    return {
        "enabled": False,
        "timezone": src.get("timezone") or "Asia/Shanghai",
        "scanIntervalMs": src.get("scanIntervalMs") or 60000,
        "sendHour": src.get("sendHour", 7),
        "sendMinute": src.get("sendMinute", 0),
        "reportDayCutoffHour": src.get("reportDayCutoffHour", 17),
        "reportDayCutoffMinute": src.get("reportDayCutoffMinute", 0),
        "title": "微光项目组日报",
        "pushMode": "full",
        "stateDir": "/app/data/daily-report-state",
        "webhook": {"accessToken": ""},
        "orgs": [
            {
                "label": ORG_LABEL,
                "appKey": weiguang.get("appKey"),
                "appSecret": weiguang.get("appSecret"),
                "templateName": weiguang.get("templateName") or "",
                "employees": [],
                "projectViews": [],
            }
        ],
    }


def main() -> None:
    cfg = load_or_bootstrap()
    org = next((o for o in cfg.get("orgs") or [] if o.get("label") == ORG_LABEL), None)
    if not org:
        print(f"org not found: {ORG_LABEL}", file=sys.stderr)
        sys.exit(1)
    views = list(org.get("projectViews") or [])
    idx = next((i for i, v in enumerate(views) if v.get("id") == VIEW["id"]), -1)
    if idx >= 0:
        views[idx] = VIEW
    else:
        views.append(VIEW)
    org["projectViews"] = views
    # 与 mingsibot 微光 org 对齐：勿默认 templateName=日报（会导致 report/list 40035）
    fb = Path(FALLBACK)
    if fb.is_file():
        src = json.loads(fb.read_text(encoding="utf-8"))
        wg = next((o for o in src.get("orgs") or [] if o.get("label") == ORG_LABEL), None)
        if wg is not None:
            org["templateName"] = wg.get("templateName") or ""
    path = Path(CONFIG_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[ok] managebot config {CONFIG_PATH}: projectViews patched → {VIEW['id']}")


if __name__ == "__main__":
    main()
