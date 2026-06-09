#!/usr/bin/env bash
# One-off: pull code, patch webhook + MEETING_IMPORT_ENABLED, rebuild image, restart both containers, manual send.
set -euo pipefail

ACCESS_TOKEN="${1:?usage: $0 <access_token> <secret>}"
SECRET="${2:?usage: $0 <access_token> <secret>}"

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
CONFIG=/opt/manage_robot-mingsibot/data/daily-report-digest.config.json

update_kv() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "[1/6] git pull"
cd "$REPO"
git fetch origin feat/draft-full-memory-mutate
git checkout feat/draft-full-memory-mutate
git reset --hard origin/feat/draft-full-memory-mutate
git log -1 --oneline

echo "[2/6] docker build"
docker build -t "$IMAGE" .

echo "[3/6] patch env (MEETING_IMPORT_ENABLED=0 on both sides)"
update_kv /etc/manage-robot.env MEETING_IMPORT_ENABLED 0
update_kv /etc/manage-robot-mingsibot.env MEETING_IMPORT_ENABLED 0
update_kv /etc/manage-robot-mingsibot.env DAILY_REPORT_DIGEST_ENABLED 1
update_kv /etc/manage-robot-mingsibot.env DAILY_REPORT_DIGEST_CONFIG_FILE /app/data/daily-report-digest.config.json

echo "[4/6] patch daily-report webhook config"
python3 - <<PY
import json
from pathlib import Path
p = Path("$CONFIG")
cfg = json.loads(p.read_text(encoding="utf-8"))
cfg.setdefault("webhook", {})
cfg["webhook"]["accessToken"] = "$ACCESS_TOKEN"
cfg["webhook"]["secret"] = "$SECRET"
cfg["sendHour"] = 7
cfg["sendMinute"] = 0
p.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("[ok] config patched:", p)
PY

restart_container() {
  local name="$1" envfile="$2" datadir="$3" port="$4" hostport="$5"
  docker stop "$name" 2>/dev/null || true
  docker rm "$name" 2>/dev/null || true
  mkdir -p "$datadir/sessions" "$datadir/events" "$datadir/plans"
  docker run -d --name "$name" --restart unless-stopped \
    --env-file "$envfile" \
    -v "$datadir:/app/data" \
    -p "${hostport}:${port}" \
    "$IMAGE"
  for i in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${hostport}/health" >/dev/null 2>&1; then
      echo "[ok] $name health ready"
      return 0
    fi
    sleep 2
  done
  echo "[warn] $name health not ready"
  docker logs --tail 20 "$name" || true
}

echo "[5/6] restart containers"
restart_container manage-robot-dingtalk /etc/manage-robot.env /opt/manage_robot/data 8080 8080
restart_container manage-robot-mingsibot /etc/manage-robot-mingsibot.env /opt/manage_robot-mingsibot/data 8081 8081

echo "[6/6] manual send yesterday digest"
docker exec manage-robot-mingsibot npx tsx scripts/send-daily-report-digest-now.ts

echo "[done] MEETING_IMPORT_ENABLED:"
docker exec manage-robot-dingtalk printenv MEETING_IMPORT_ENABLED || true
docker exec manage-robot-mingsibot printenv MEETING_IMPORT_ENABLED || true
