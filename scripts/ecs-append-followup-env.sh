#!/usr/bin/env bash
# Run ON ECS as root: bash /opt/manage_robot/scripts/ecs-append-followup-env.sh
# Appends follow-up reminder env keys to /etc/manage-robot.env (idempotent).

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

# Follow-up scheduler + manual remind (v1)
set_kv FOLLOWUP_REMINDER_ENABLED "1"
set_kv FOLLOWUP_SCAN_INTERVAL_MS "300000"
set_kv FOLLOWUP_TIMEZONE "Asia/Shanghai"
set_kv FOLLOWUP_TIER2_AFTER_OVERDUE_DAYS "1"
set_kv FOLLOWUP_QUIET_HOURS "22:00-08:00"
set_kv FOLLOWUP_MANUAL_LLM_ENABLED "1"
set_kv FOLLOWUP_MANUAL_LLM_TIMEOUT_MS "5000"

# DingTalk notify required for todo/robot/card channels
set_kv WORKBENCH_DINGTALK_NOTIFY_ENABLED "1"

echo "[ecs-append-followup-env] updated ${ENV_FILE}:"
grep -E '^FOLLOWUP_|^WORKBENCH_DINGTALK_NOTIFY_ENABLED=' "$ENV_FILE" || true
