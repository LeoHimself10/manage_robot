#!/usr/bin/env bash
# Deploy daily-report project groups + dual view to mingsibot (no group webhook test send).
set -euo pipefail

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
CONFIG=/opt/manage_robot-mingsibot/data/daily-report-digest.config.json
XUETING_ID=15666300631083452

echo "[1/5] git pull"
cd "$REPO"
git fetch origin feat/draft-full-memory-mutate
git checkout feat/draft-full-memory-mutate
git reset --hard origin/feat/draft-full-memory-mutate
git log -1 --oneline

echo "[2/5] docker build"
docker build -t "$IMAGE" .

echo "[3/5] patch daily-report config (projectFilter, projectGroup, createWorkbookOnSend)"
python3 - <<'PY'
import json
from pathlib import Path

p = Path("/opt/manage_robot-mingsibot/data/daily-report-digest.config.json")
cfg = json.loads(p.read_text(encoding="utf-8"))
cfg["createWorkbookOnSend"] = False

ming_filters = ["Y2602-微导管", "Y2601-脑机机器人", "2501-颅内OCT"]
wei_filters = [
    "2310-一次性使用颅内动脉成像导管-IC019/IC018-40/IC018-60",
    "Y057-预研-脑机机器人",
]
brain_names = {"崔枭", "贾三祥"}
ops_names = {"薛婷"}

for org in cfg.get("orgs") or []:
    label = str(org.get("label") or "").strip()
    if label == "明思":
        org["projectFilter"] = ming_filters
    elif label == "微光":
        org["projectFilter"] = wei_filters
    for emp in org.get("employees") or []:
        name = str(emp.get("name") or "").strip()
        if not emp.get("projectGroup"):
            if name in brain_names:
                emp["projectGroup"] = "brain"
            elif name in ops_names:
                emp["projectGroup"] = "ops"
            else:
                emp["projectGroup"] = "intracranial"

p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("[ok] config patched:", p)
PY

echo "[4/5] verify 薛婷 not in manager whitelist"
python3 - <<PY
import json, os, re
from pathlib import Path
uid = "$XUETING_ID"
hits = []
for envfile in ["/etc/manage-robot.env", "/etc/manage-robot-mingsibot.env"]:
    if not Path(envfile).exists():
        continue
    for line in Path(envfile).read_text(encoding="utf-8").splitlines():
        if line.startswith("WORKBENCH_MANAGER_USER_IDS=") and uid in line:
            hits.append(f"{envfile}: WORKBENCH_MANAGER_USER_IDS")
for fp in [
    "/opt/manage_robot/data/workbench-managers.json",
    "/opt/manage_robot-mingsibot/data/workbench-managers.json",
]:
    p = Path(fp)
    if not p.exists():
        continue
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        ids = data if isinstance(data, list) else data.get("userIds") or data.get("ids") or []
        if uid in [str(x) for x in ids]:
            hits.append(f"{fp}")
    except Exception as e:
        hits.append(f"{fp} (parse err: {e})")
if hits:
    raise SystemExit(f"[FAIL] 薛婷 {uid} found in manager whitelist: {hits}")
print("[ok] 薛婷 not in manager whitelist")
PY

echo "[5/5] restart manage-robot-mingsibot"
docker stop manage-robot-mingsibot 2>/dev/null || true
docker rm manage-robot-mingsibot 2>/dev/null || true
mkdir -p /opt/manage_robot-mingsibot/data/sessions /opt/manage_robot-mingsibot/data/events /opt/manage_robot-mingsibot/data/plans
docker run -d --name manage-robot-mingsibot --restart unless-stopped \
  --env-file /etc/manage-robot-mingsibot.env \
  -v /opt/manage_robot-mingsibot/data:/app/data \
  -p 8081:8081 \
  "$IMAGE"

for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8081/health >/dev/null 2>&1; then
    echo "[ok] health ready"
    exit 0
  fi
  sleep 2
done
echo "[warn] health not ready"
docker logs --tail 30 manage-robot-mingsibot || true
exit 1
