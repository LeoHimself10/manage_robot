#!/usr/bin/env bash
# Add 朱锐 (014517256544) to WORKBENCH_PROJECT_PORTFOLIO_USER_IDS on ECS.
set -euo pipefail

ENV_FILE="${1:-/etc/manage-robot.env}"
ZHURUI_ID="014517256544"
CONTAINER="${2:-manage-robot-dingtalk}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "FATAL: env file not found: $ENV_FILE" >&2
  exit 1
fi

BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
echo "Backed up to $BACKUP"

current="$(grep -E '^WORKBENCH_PROJECT_PORTFOLIO_USER_IDS=' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -z "$current" ]]; then
  new_ids="$ZHURUI_ID"
elif echo ",$current," | grep -q ",${ZHURUI_ID},"; then
  echo "Already in WORKBENCH_PROJECT_PORTFOLIO_USER_IDS: $ZHURUI_ID"
  new_ids="$current"
else
  new_ids="${current},${ZHURUI_ID}"
fi

if grep -q '^WORKBENCH_PROJECT_PORTFOLIO_USER_IDS=' "$ENV_FILE"; then
  sed -i "s/^WORKBENCH_PROJECT_PORTFOLIO_USER_IDS=.*/WORKBENCH_PROJECT_PORTFOLIO_USER_IDS=${new_ids}/" "$ENV_FILE"
else
  printf '\nWORKBENCH_PROJECT_PORTFOLIO_USER_IDS=%s\n' "$new_ids" >> "$ENV_FILE"
fi

grep '^WORKBENCH_PROJECT_PORTFOLIO_USER_IDS=' "$ENV_FILE"

if docker ps -q -f "name=^/${CONTAINER}$" | grep -q .; then
  echo "[patch] restarting $CONTAINER to reload env ..."
  docker stop "$CONTAINER"
  docker rm "$CONTAINER"
  PORT="${MANAGE_ROBOT_PUBLISH_PORT:-8080}"
  DATADIR="${MANAGE_ROBOT_DATA_DIR:-/opt/manage_robot/data}"
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    --env-file "$ENV_FILE" \
    -v "${DATADIR}:/app/data" \
    -p "${PORT}:8080" \
    manage-robot:dingtalk
  for i in $(seq 1 20); do
    if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      echo "[patch] health ok"
      exit 0
    fi
    sleep 2
  done
  echo "[patch] WARN: /health not ready; check docker logs" >&2
fi
