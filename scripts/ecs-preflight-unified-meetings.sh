#!/usr/bin/env bash
# Read-only against production data. The migration rehearsal runs on a temporary DB copy.
set -euo pipefail

INSTANCE="${1:-}"
IMAGE="${IMAGE:-manage-robot:dingtalk-unified-meetings}"

case "$INSTANCE" in
  managebot)
    CONTAINER="manage-robot-dingtalk"
    DATA_DIR="/opt/manage_robot/data"
    ENV_FILE="/etc/manage-robot.env"
    ;;
  mingsibot)
    CONTAINER="manage-robot-mingsibot"
    DATA_DIR="/opt/manage_robot-mingsibot/data"
    ENV_FILE="/etc/manage-robot-mingsibot.env"
    ;;
  *)
    echo "usage: $0 <managebot|mingsibot>"
    exit 2
    ;;
esac

DB_FILE="$DATA_DIR/workbench/workbench.sqlite"
PROFILES_FILE="$DATA_DIR/dws-minutes-profiles.json"

echo "[1/7] running container"
docker inspect -f 'status={{.State.Status}} image={{.Config.Image}}' "$CONTAINER"

echo "[2/7] candidate image and DWS"
docker image inspect "$IMAGE" >/dev/null
docker run --rm "$IMAGE" dws --version

echo "[3/7] current feature prerequisites"
for key in TASK_INTAKE_DINGTALK_MEETINGS_ENABLED DINGTALK_CONTACT_SYNC_ENABLED; do
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ "$value" != "1" ]]; then
    echo "missing prerequisite: $key=1 in $ENV_FILE"
    exit 1
  fi
done

echo "[4/7] production DB integrity (read-only)"
test -s "$DB_FILE"
docker run --rm \
  -v "$DATA_DIR:/app/data:ro" \
  "$IMAGE" \
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/app/data/workbench/workbench.sqlite",{readOnly:true});const r=db.prepare("PRAGMA quick_check").get();console.log(r.integrity_check||r.quick_check||JSON.stringify(r));db.close()' \
  | grep -qx ok

echo "[5/7] schema migration rehearsal on a temporary copy"
TMP_DIR="$(mktemp -d /tmp/manage-robot-meeting-preflight.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
cp "$DB_FILE" "$TMP_DIR/workbench.sqlite"
docker run --rm \
  -v "$TMP_DIR:/preflight" \
  -e WORKBENCH_SQLITE_PATH=/preflight/workbench.sqlite \
  "$IMAGE" \
  node --import tsx -e 'import {createDingTalkMeetingStore} from "./src/infra/dingtalk-meeting-store.ts";const s=createDingTalkMeetingStore();s.close();'
docker run --rm \
  -v "$TMP_DIR:/preflight" \
  "$IMAGE" \
  node -e 'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/preflight/workbench.sqlite",{readOnly:true});const cols=db.prepare("PRAGMA table_info(dingtalk_meetings)").all().map(x=>x.name);for(const c of ["source_kind","video_conference_id","task_uuid"]){if(!cols.includes(c))throw new Error("missing "+c)}const aliases=db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table","dingtalk_meeting_aliases");if(!aliases)throw new Error("missing aliases table");db.close();'

echo "[6/7] event listener"
docker logs --since 24h "$CONTAINER" >"$TMP_DIR/container.log" 2>&1
grep -q dingtalk_meeting_event_listener_started "$TMP_DIR/container.log"

echo "[7/7] isolated manager authorization profiles"
if [[ ! -s "$PROFILES_FILE" ]]; then
  echo "authorization required: $PROFILES_FILE has not been created"
  exit 10
fi
python3 - "$PROFILES_FILE" <<'PY'
import json
import os
import sys

with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
if not isinstance(data, dict) or not data:
    raise SystemExit("profiles mapping is empty")
for user_id, profile in data.items():
    if not isinstance(user_id, str) or not user_id:
        raise SystemExit("invalid manager userId")
    if not isinstance(profile, str) or not profile.startswith("/app/data/dws-profiles/"):
        raise SystemExit(f"invalid profile path for {user_id}")
print(f"profiles={len(data)}")
PY

while IFS=$'\t' read -r user_id profile; do
  echo "verify profile: $user_id"
  docker run --rm \
    -v "$DATA_DIR:/app/data" \
    -e "HOME=$profile" \
    -e "USERPROFILE=$profile" \
    "$IMAGE" \
    dws auth status --format json >/dev/null
  docker run --rm \
    -v "$DATA_DIR:/app/data" \
    -e "HOME=$profile" \
    -e "USERPROFILE=$profile" \
    "$IMAGE" \
    dws minutes list all --limit 1 --format json >/dev/null
done < <(python3 - "$PROFILES_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    data = json.load(fh)
for user_id, profile in data.items():
    print(f"{user_id}\t{profile}")
PY
)

echo "[ok] $INSTANCE unified meeting import preflight passed"
