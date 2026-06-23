#!/usr/bin/env bash
# 微光 managebot：部署「能力评估」聊天 + 项目组日报能力（曹一挥 + 姚凯珩白名单）
#
# ECS 用法：
#   cd /opt/manage_robot && bash scripts/ecs-deploy-competency-eval-managebot.sh
#
set -euo pipefail

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
CONTAINER=manage-robot-dingtalk
ENVFILE=/etc/manage-robot.env
DATADIR=/opt/manage_robot/data
CONFIG=$DATADIR/daily-report-digest.config.json
PORT=8080
BRANCH=feat/draft-full-memory-mutate

update_kv() {
  local file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "[1/6] git pull $BRANCH"
cd "$REPO"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git log -1 --oneline

echo "[2/6] patch managebot env (competency-eval + project views + daily reports page)"
update_kv "$ENVFILE" COMPETENCY_EVAL_ENABLED 1
update_kv "$ENVFILE" COMPETENCY_EVAL_USER_IDS "01451725613871,641871342"
update_kv "$ENVFILE" DAILY_REPORT_PROJECT_VIEWS_ENABLED 1
update_kv "$ENVFILE" DAILY_REPORT_DIGEST_CONFIG_FILE /app/data/daily-report-digest.config.json
update_kv "$ENVFILE" DAILY_REPORTS_PAGE_ENABLED 1
update_kv "$ENVFILE" DAILY_REPORT_DIGEST_ENABLED 0
update_kv "$ENVFILE" DAILY_REPORT_PROJECT_VIEW_DIGEST_ENABLED 1
grep -E '^(COMPETENCY_EVAL_|DAILY_REPORT)' "$ENVFILE" | head -20

echo "[3/6] ensure managebot digest config + projectViews"
python3 scripts/ecs-patch-project-view.py

echo "[4/6] docker build"
docker build -t "$IMAGE" .

echo "[5/6] recreate $CONTAINER"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
mkdir -p "$DATADIR/sessions" "$DATADIR/events" "$DATADIR/plans" \
  "$DATADIR/daily-report-state" "$DATADIR/competency-eval"
docker run -d --name "$CONTAINER" --restart unless-stopped \
  --env-file "$ENVFILE" \
  -v "$DATADIR:/app/data" \
  -p "${PORT}:${PORT}" \
  "$IMAGE"

echo "[6/6] health"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[ok] https://managebot.vivolightsales.com/workbench/manager/competency-eval"
    echo "[done] 曹一挥/姚凯珩：侧栏「能力评估」；可评项目组 roster 内员工日报"
    exit 0
  fi
  sleep 2
done
echo "[warn] health not ready"
docker logs --tail 40 "$CONTAINER" || true
exit 1
