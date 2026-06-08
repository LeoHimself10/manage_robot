#!/usr/bin/env bash
set -euo pipefail

CADDY=/opt/caddy/Caddyfile
cp -a "$CADDY" "${CADDY}.bak.$(date +%Y%m%d-%H%M%S)"
if ! grep -q 'mingsibot.vivolightsales.com' "$CADDY"; then
  cat >> "$CADDY" <<'EOF'

mingsibot.vivolightsales.com {
  reverse_proxy 127.0.0.1:8081
}
EOF
fi
docker exec manage-robot-caddy caddy validate --config /etc/caddy/Caddyfile
docker exec manage-robot-caddy caddy reload --config /etc/caddy/Caddyfile
echo "[ok] Caddy updated and reloaded"

mkdir -p /opt/manage_robot-mingsibot/data
chmod 755 /opt/manage_robot-mingsibot /opt/manage_robot-mingsibot/data

ENV2=/etc/manage-robot-mingsibot.env
if [ ! -f "$ENV2" ]; then
  cp /etc/manage-robot.env "$ENV2"
  chmod 600 "$ENV2"
  sed -i \
    -e 's|^HEALTH_CHECK_PORT=.*|HEALTH_CHECK_PORT=8081|' \
    -e 's|^ASSIGNMENT_WEB_PORT=.*|ASSIGNMENT_WEB_PORT=8081|' \
    -e 's|^ASSIGNMENT_WEB_PUBLIC_BASE_URL=.*|ASSIGNMENT_WEB_PUBLIC_BASE_URL=https://mingsibot.vivolightsales.com|' \
    -e 's|^WORKBENCH_NOTIFY_DETAIL_URL_BASE=.*|WORKBENCH_NOTIFY_DETAIL_URL_BASE=https://mingsibot.vivolightsales.com/workbench/employee/task|' \
    "$ENV2"
  NEW_ASSIGN_SECRET=$(openssl rand -hex 32)
  NEW_SESSION_SECRET=$(openssl rand -hex 32)
  sed -i "s|^ASSIGNMENT_WEB_SECRET=.*|ASSIGNMENT_WEB_SECRET=${NEW_ASSIGN_SECRET}|" "$ENV2"
  sed -i "s|^WORKBENCH_SESSION_SECRET=.*|WORKBENCH_SESSION_SECRET=${NEW_SESSION_SECRET}|" "$ENV2"
  for key in DINGTALK_CLIENT_ID DINGTALK_CLIENT_SECRET DINGTALK_CORP_ID DINGTALK_AGENT_ID DINGTALK_ROBOT_CODE WORKBENCH_MANAGER_USER_IDS WORKBENCH_ADMIN_USER_IDS WORKBENCH_PROJECT_PORTFOLIO_USER_IDS; do
    sed -i "s|^${key}=.*|${key}=|" "$ENV2" || true
  done
fi
echo "[ok] env file: $ENV2"

CONTAINER=manage-robot-mingsibot
IMAGE=manage-robot:dingtalk
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "[skip] container $CONTAINER already exists"
else
  CID=$(grep '^DINGTALK_CLIENT_ID=' "$ENV2" | cut -d= -f2- | tr -d '[:space:]')
  CSEC=$(grep '^DINGTALK_CLIENT_SECRET=' "$ENV2" | cut -d= -f2- | tr -d '[:space:]')
  if [ -n "$CID" ] && [ -n "$CSEC" ]; then
    docker run -d --name "$CONTAINER" --restart unless-stopped \
      --env-file "$ENV2" \
      -v /opt/manage_robot-mingsibot/data:/app/data \
      -p 8081:8081 \
      "$IMAGE"
    sleep 3
    curl -sf "http://127.0.0.1:8081/health" && echo " health ok" || echo " health pending/failed"
  else
    echo "[wait] DINGTALK_CLIENT_ID/SECRET empty — container not started yet"
  fi
fi

echo "--- Caddyfile ---"
cat "$CADDY"
echo "--- dingtalk env filled? ---"
grep -E '^(DINGTALK_CLIENT_ID|DINGTALK_CLIENT_SECRET|DINGTALK_CORP_ID|DINGTALK_AGENT_ID|WORKBENCH_MANAGER_USER_IDS)=' "$ENV2" | while IFS= read -r line; do
  key="${line%%=*}"
  val="${line#*=}"
  if [ -n "$val" ]; then echo "${key}=set"; else echo "${key}=EMPTY"; fi
done
