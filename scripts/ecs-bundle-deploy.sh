#!/usr/bin/env bash
set -euo pipefail
cd /opt/manage_robot
BUNDLE="${1:-/tmp/manage-robot-deploy.bundle}"
git fetch "$BUNDLE" HEAD:refs/heads/deploy-bundle-tmp
git checkout feat/draft-full-memory-mutate
git reset --hard deploy-bundle-tmp
git branch -D deploy-bundle-tmp 2>/dev/null || true
git log -1 --oneline

CONTAINER=manage-robot-dingtalk
IMAGE=manage-robot:dingtalk
PORT=8080
ENVFILE=/etc/manage-robot.env
DATADIR=/opt/manage_robot/data

mkdir -p "$DATADIR/sessions" "$DATADIR/events" "$DATADIR/plans"
echo "[deploy] docker build ..."
docker build -t "$IMAGE" .
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
docker run -d --name "$CONTAINER" --restart unless-stopped \
  --env-file "$ENVFILE" \
  -v "$DATADIR:/app/data" \
  -p "${PORT}:8080" \
  "$IMAGE"

echo "[deploy] wait for /health ..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[deploy] health ok"
    docker ps --filter "name=$CONTAINER"
    docker logs --tail 20 "$CONTAINER"
    exit 0
  fi
  sleep 2
done

echo "[deploy] FATAL: /health not ready"
docker logs --tail 50 "$CONTAINER" || true
exit 1
