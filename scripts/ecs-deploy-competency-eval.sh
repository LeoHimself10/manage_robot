#!/usr/bin/env bash
# 明思 mingsibot：部署「能力评估」聊天功能 + 开启白名单（曹一挥 + 姚凯珩）
#
# ECS 用法：
#   cd /opt/manage_robot && bash scripts/ecs-deploy-competency-eval.sh
#
set -euo pipefail

REPO=/opt/manage_robot
IMAGE=manage-robot:dingtalk
ENV_FILE=/etc/manage-robot-mingsibot.env
CONTAINER=manage-robot-mingsibot
DATA_VOL=/opt/manage_robot-mingsibot/data
PORT=8081
BRANCH=feat/draft-full-memory-mutate

patch_env() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

echo "[1/5] git pull $BRANCH"
cd "$REPO"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"
git log -1 --oneline

echo "[2/5] patch mingsibot env"
patch_env COMPETENCY_EVAL_ENABLED 1
patch_env COMPETENCY_EVAL_USER_IDS "01451725613871,641871342"
grep -E '^COMPETENCY_EVAL_' "$ENV_FILE"

echo "[3/5] docker build"
docker build -t "$IMAGE" .

echo "[4/5] recreate $CONTAINER (env-file requires new container)"
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
mkdir -p "${DATA_VOL}/sessions" "${DATA_VOL}/events" "${DATA_VOL}/plans" "${DATA_VOL}/competency-eval"
docker run -d --name "$CONTAINER" --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -v "${DATA_VOL}:/app/data" \
  -p "${PORT}:${PORT}" \
  "$IMAGE"

echo "[5/5] health check"
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[ok] https://mingsibot.vivolightsales.com/workbench/manager/competency-eval"
  echo "[done] 曹一挥/姚凯珩：侧栏「能力评估」→ 📎上传标准 → 对话评人"
    exit 0
  fi
  sleep 2
done
echo "[warn] health not ready after 60s"
docker logs --tail 40 "$CONTAINER" || true
exit 1
