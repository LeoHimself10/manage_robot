#!/bin/sh
set -eu
ENV_FILE=/etc/manage-robot.env
append_if_missing() {
  key="$1"
  val="$2"
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
  fi
}
# Tuning from recent dingtalk deploy (idempotent updates via sed)
for pair in \
  "DRAFT_FALLBACK_EXTRACT_ENABLED=0" \
  "QWEN_MAX_TOKENS=8000" \
  "DINGTALK_QWEN_MAX_TOKENS=8000" \
  "DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=10" \
  "ASSIGNMENT_WEB_PORT=8787"; do
  k="${pair%%=*}"
  v="${pair#*=}"
  if grep -q "^${k}=" "$ENV_FILE"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
done
append_if_missing "DINGTALK_ROLE_ROUTING_ENABLED" "1"
if ! grep -q "641871342" "$ENV_FILE" 2>/dev/null; then
  sed -i 's|^WORKBENCH_MANAGER_USER_IDS=.*|WORKBENCH_MANAGER_USER_IDS=manager-test-1,641871342|' "$ENV_FILE" \
    || echo "WORKBENCH_MANAGER_USER_IDS=641871342" >> "$ENV_FILE"
fi
echo "=== patched $ENV_FILE keys (values hidden) ==="
grep -E '^(ASSIGNMENT_|HEALTH_CHECK|WORKBENCH_MANAGER|DINGTALK_ROLE)' "$ENV_FILE" | sed 's/=.*/=***/'

IMAGE="${1:-manage_robot:v6.3.0}"
docker rm -f manage-robot-dingtalk 2>/dev/null || true
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -v /opt/manage_robot/data:/app/data \
  -v /opt/manage_robot/logs:/app/logs \
  -p 8787:8787 \
  -p 8080:8080 \
  "$IMAGE"
sleep 5
echo "=== listen logs ==="
docker logs manage-robot-dingtalk 2>&1 | grep -E 'listening on|Stream' | tail -6
echo "=== curl 8787 ==="
curl -sS -m 5 http://127.0.0.1:8787/health || true
echo
curl -sS -m 5 -o /dev/null -w 'workbench HTTP %{http_code}\n' http://127.0.0.1:8787/workbench || true
