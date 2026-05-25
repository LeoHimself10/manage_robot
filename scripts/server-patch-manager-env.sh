#!/bin/bash
set -euo pipefail
ENV_FILE="/opt/manage_robot/.env"
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d%H%M%S)"

cp "$ENV_FILE" "$BACKUP"
echo "Backed up to $BACKUP"

grep -q '^DINGTALK_ROLE_ROUTING_ENABLED=' "$ENV_FILE" && \
  sed -i 's/^DINGTALK_ROLE_ROUTING_ENABLED=.*/DINGTALK_ROLE_ROUTING_ENABLED=1/' "$ENV_FILE" || \
  printf '\n# === manager / role routing ===\nDINGTALK_ROLE_ROUTING_ENABLED=1\n' >> "$ENV_FILE"

grep -q '^WORKBENCH_MANAGER_USER_IDS=' "$ENV_FILE" && \
  sed -i 's/^WORKBENCH_MANAGER_USER_IDS=.*/WORKBENCH_MANAGER_USER_IDS=641871342/' "$ENV_FILE" || \
  printf 'WORKBENCH_MANAGER_USER_IDS=641871342\n' >> "$ENV_FILE"

echo "--- tail of .env ---"
grep -E 'DINGTALK_ROLE_ROUTING_ENABLED|WORKBENCH_MANAGER_USER_IDS' "$ENV_FILE"
