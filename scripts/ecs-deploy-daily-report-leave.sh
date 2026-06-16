#!/usr/bin/env bash
# Deploy daily-report leave detection (getleavestatus) to mingsibot.
# No group webhook test send, no preview messages.
set -euo pipefail

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
CONFIG=/opt/manage_robot-mingsibot/data/daily-report-digest.config.json
BRANCH=feat/draft-full-memory-mutate

echo "[1/4] git pull $BRANCH"
cd "$REPO"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git log -1 --oneline

echo "[2/4] docker build"
docker build -t "$IMAGE" .

echo "[3/4] ensure leaveCheckEnabled=true in config (explicit for visibility)"
python3 - <<'PY'
import json
from pathlib import Path

p = Path("/opt/manage_robot-mingsibot/data/daily-report-digest.config.json")
cfg = json.loads(p.read_text(encoding="utf-8"))
cfg.setdefault("leaveCheckEnabled", True)
p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"[ok] config leaveCheckEnabled={cfg['leaveCheckEnabled']}")
PY

echo "[4/4] restart manage-robot-mingsibot"
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
echo "[warn] health not ready after 60s"
docker logs --tail 30 manage-robot-mingsibot || true
exit 1
