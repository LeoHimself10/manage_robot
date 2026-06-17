#!/usr/bin/env bash
# Deploy 微光项目组日报视图到 **managebot**（manage-robot-dingtalk :8080）。
# legacy 明思+微光 digest 仍在 mingsibot，本脚本不重启 mingsibot。
set -euo pipefail

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
CONTAINER=manage-robot-dingtalk
ENVFILE=/etc/manage-robot.env
DATADIR=/opt/manage_robot/data
CONFIG=$DATADIR/daily-report-digest.config.json

update_kv() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

cd "$REPO"
echo "[1/5] patch managebot env (project views + daily reports page)"
update_kv "$ENVFILE" DAILY_REPORT_PROJECT_VIEWS_ENABLED 1
update_kv "$ENVFILE" DAILY_REPORT_DIGEST_CONFIG_FILE /app/data/daily-report-digest.config.json
update_kv "$ENVFILE" DAILY_REPORTS_PAGE_ENABLED 1
# 不在 managebot 开 legacy 群早报（仍由 mingsibot DAILY_REPORT_DIGEST_ENABLED 负责）
update_kv "$ENVFILE" DAILY_REPORT_DIGEST_ENABLED 0

echo "[2/5] patch projectViews in $CONFIG"
node scripts/ecs-patch-project-view.mjs

echo "[3/5] docker build"
docker build -t "$IMAGE" .

echo "[4/5] restart $CONTAINER (must stop/rm/run to reload env-file)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
mkdir -p "$DATADIR/sessions" "$DATADIR/events" "$DATADIR/plans" "$DATADIR/daily-report-state"
docker run -d --name "$CONTAINER" --restart unless-stopped \
  --env-file "$ENVFILE" \
  -v "$DATADIR:/app/data" \
  -p 8080:8080 \
  "$IMAGE"

echo "[5/5] health"
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then
    echo "[ok] https://managebot.vivolightsales.com/workbench/manager/daily-reports"
    docker exec "$CONTAINER" printenv DAILY_REPORT_PROJECT_VIEWS_ENABLED
    exit 0
  fi
  sleep 2
done
echo "[warn] health check failed"
docker logs --tail 30 "$CONTAINER" || true
exit 1
