#!/usr/bin/env bash
# Run on ECS only after both instance preflights pass.
set -euo pipefail

IMAGE="${IMAGE:-manage-robot:dingtalk-unified-meetings}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/opt/manage_robot-deploy-backups/unified-meetings-$STAMP"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$BACKUP_DIR"

instances=(
  "managebot|manage-robot-dingtalk|/etc/manage-robot.env|/opt/manage_robot/data|8080"
  "mingsibot|manage-robot-mingsibot|/etc/manage-robot-mingsibot.env|/opt/manage_robot-mingsibot/data|8081"
)

declare -A old_images

update_env() {
  local file="$1"
  python3 - "$file" <<'PY'
import os
import sys
import tempfile

path = sys.argv[1]
updates = {
    "TASK_INTAKE_DINGTALK_MEETINGS_ENABLED": "1",
    "DINGTALK_MINUTES_DWS_ENABLED": "1",
    "DINGTALK_MINUTES_DWS_PATH": "/usr/local/bin/dws",
    "DINGTALK_MINUTES_DWS_PROFILES_FILE": "/app/data/dws-minutes-profiles.json",
    "DINGTALK_MINUTES_DWS_TIMEOUT_MS": "30000",
    "DINGTALK_MINUTES_DWS_MAX_PAGES": "20",
}
with open(path, "r", encoding="utf-8") as fh:
    lines = fh.read().splitlines()
seen = set()
out = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line and not line.lstrip().startswith("#") else ""
    if key in updates:
        out.append(f"{key}={updates[key]}")
        seen.add(key)
    else:
        out.append(line)
for key, value in updates.items():
    if key not in seen:
        out.append(f"{key}={value}")
parent = os.path.dirname(path)
fd, tmp = tempfile.mkstemp(prefix=".manage-robot-env.", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
PY
}

run_instance() {
  local name="$1" container="$2" env_file="$3" data_dir="$4" port="$5" image="$6"
  mkdir -p "$data_dir/sessions" "$data_dir/events" "$data_dir/plans"
  docker run -d --name "$container" --restart unless-stopped \
    --env-file "$env_file" \
    -v "$data_dir:/app/data" \
    -p "${port}:8080" \
    "$image" >/dev/null
  for _ in $(seq 1 30); do
    if wget -qO- "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      echo "[ok] $name health"
      return 0
    fi
    sleep 2
  done
  docker logs --tail 80 "$container" || true
  return 1
}

rollback() {
  local exit_code=$?
  trap - ERR
  echo "[rollback] activation failed; restoring env files and previous images"
  for spec in "${instances[@]}"; do
    IFS='|' read -r name container env_file data_dir port <<<"$spec"
    if [[ -f "$BACKUP_DIR/$name.env" ]]; then
      cp "$BACKUP_DIR/$name.env" "$env_file"
      chmod 600 "$env_file"
    fi
    docker rm -f "$container" >/dev/null 2>&1 || true
    if [[ -n "${old_images[$name]:-}" ]]; then
      run_instance "$name" "$container" "$env_file" "$data_dir" "$port" "${old_images[$name]}" || true
    fi
  done
  exit "$exit_code"
}
docker image inspect "$IMAGE" >/dev/null

for spec in "${instances[@]}"; do
  IFS='|' read -r name _ _ data_dir _ <<<"$spec"
  test -s "$data_dir/dws-minutes-profiles.json"
done

for spec in "${instances[@]}"; do
  IFS='|' read -r name _ _ _ _ <<<"$spec"
  IMAGE="$IMAGE" bash "$SCRIPT_DIR/ecs-preflight-unified-meetings.sh" "$name"
done

for spec in "${instances[@]}"; do
  IFS='|' read -r name container env_file data_dir _ <<<"$spec"
  old_images[$name]="$(docker inspect -f '{{.Image}}' "$container")"
  cp "$env_file" "$BACKUP_DIR/$name.env"
  chmod 600 "$BACKUP_DIR/$name.env"
  mkdir -p "$BACKUP_DIR/$name"
  snapshot_name=".unified-meetings-$STAMP.sqlite"
  docker exec "$container" node -e \
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/workbench/workbench.sqlite');db.exec(\"VACUUM INTO '/app/data/$snapshot_name'\");db.close();"
  mv "$data_dir/$snapshot_name" "$BACKUP_DIR/$name/workbench.sqlite"
done

trap rollback ERR

for spec in "${instances[@]}"; do
  IFS='|' read -r name container env_file data_dir port <<<"$spec"
  update_env "$env_file"
  docker stop "$container" >/dev/null
  docker rm "$container" >/dev/null
  run_instance "$name" "$container" "$env_file" "$data_dir" "$port" "$IMAGE"
done

trap - ERR
echo "[ok] unified meeting import activated for both instances"
echo "backup_dir=$BACKUP_DIR"
