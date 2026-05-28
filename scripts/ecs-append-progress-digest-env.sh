#!/usr/bin/env bash
# Run ON ECS as root: bash /opt/manage_robot/scripts/ecs-append-progress-digest-env.sh
# Appends progress digest env keys to /etc/manage-robot.env (idempotent).

set -euo pipefail

ENV_FILE="${1:-/etc/manage-robot.env}"

touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true

set_kv() {
  local key="$1"
  local val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}

set_kv PROGRESS_DIGEST_ENABLED "1"
set_kv PROGRESS_DIGEST_MODE "delivery_reminder"
set_kv PROGRESS_DIGEST_HORIZON_DAYS "7"
set_kv PROGRESS_DIGEST_SCAN_INTERVAL_MS "300000"
set_kv PROGRESS_DIGEST_TIMEZONE "Asia/Shanghai"
set_kv PROGRESS_DIGEST_HOUR "9"
set_kv PROGRESS_DIGEST_MINUTE "0"
set_kv PROGRESS_DIGEST_WEEKDAYS_ONLY "1"
set_kv PROGRESS_DIGEST_LOOKBACK_HOURS "24"
set_kv PROGRESS_DIGEST_MAX_TASK_LINES "8"
set_kv PROGRESS_DIGEST_LLM_ENABLED "0"
set_kv PROGRESS_DIGEST_LLM_MODEL "qwen3.6-flash"
set_kv PROGRESS_DIGEST_LLM_TIMEOUT_MS "8000"
set_kv PROGRESS_DIGEST_LLM_MAX_TOKENS "800"

set_kv WORKBENCH_DINGTALK_NOTIFY_ENABLED "1"

echo "[ecs-append-progress-digest-env] updated ${ENV_FILE}:"
grep -E '^PROGRESS_DIGEST_|^WORKBENCH_DINGTALK_NOTIFY_ENABLED=' "$ENV_FILE" || true
