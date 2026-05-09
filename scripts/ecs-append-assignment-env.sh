#!/usr/bin/env bash
# Run ON ECS as root: bash scripts/ecs-append-assignment-env.sh
# Appends assignment env keys to /etc/manage-robot.env (regenerates secret each run).

set -euo pipefail

ENV_FILE="${1:-/etc/manage-robot.env}"
PUBLIC_BASE_URL="${2:-http://47.243.199.153:8080}"

touch "$ENV_FILE"
SECRET="$(openssl rand -hex 32)"

for key in ASSIGNMENT_PHASE_ENABLED ASSIGNMENT_WEB_SECRET ASSIGNMENT_WEB_PUBLIC_BASE_URL DINGTALK_ASSIGNMENT_MOCK; do
  sed -i "/^${key}=/d" "$ENV_FILE" 2>/dev/null || true
done

{
  echo ""
  echo "ASSIGNMENT_PHASE_ENABLED=1"
  echo "ASSIGNMENT_WEB_SECRET=${SECRET}"
  echo "ASSIGNMENT_WEB_PUBLIC_BASE_URL=${PUBLIC_BASE_URL}"
  echo "DINGTALK_ASSIGNMENT_MOCK=1"
} >>"$ENV_FILE"

echo "[ecs-append-assignment-env] updated ${ENV_FILE} (secret not printed)"
