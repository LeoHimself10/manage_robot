#!/usr/bin/env bash
# Run on ECS after the candidate image has been built.
# Interactive: the manager must complete DingTalk device authorization in the browser.
set -euo pipefail

INSTANCE="${1:-}"
MANAGER_USER_ID="${2:-}"
IMAGE="${IMAGE:-manage-robot:dingtalk-unified-meetings}"

case "$INSTANCE" in
  managebot)
    DATA_DIR="/opt/manage_robot/data"
    ;;
  mingsibot)
    DATA_DIR="/opt/manage_robot-mingsibot/data"
    ;;
  *)
    echo "usage: $0 <managebot|mingsibot> <managerUserId>"
    exit 2
    ;;
esac

if [[ ! "$MANAGER_USER_ID" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "managerUserId contains unsupported characters"
  exit 2
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "candidate image not found: $IMAGE"
  exit 1
fi

PROFILE_REL="dws-profiles/$MANAGER_USER_ID"
PROFILE_HOST="$DATA_DIR/$PROFILE_REL"
PROFILE_CONTAINER="/app/data/$PROFILE_REL"
PROFILES_FILE="$DATA_DIR/dws-minutes-profiles.json"

mkdir -p "$PROFILE_HOST"
chmod 700 "$PROFILE_HOST"

echo "[1/4] verify DWS in candidate image"
docker run --rm "$IMAGE" dws --version

echo "[2/4] manager device authorization"
echo "Complete the DingTalk authorization shown by DWS. No token will be printed or copied."
docker run --rm -it \
  -v "$DATA_DIR:/app/data" \
  -e "HOME=$PROFILE_CONTAINER" \
  -e "USERPROFILE=$PROFILE_CONTAINER" \
  "$IMAGE" \
  dws auth login --device --format json

echo "[3/4] verify authorization and read-only Minutes access"
docker run --rm \
  -v "$DATA_DIR:/app/data" \
  -e "HOME=$PROFILE_CONTAINER" \
  -e "USERPROFILE=$PROFILE_CONTAINER" \
  "$IMAGE" \
  dws auth status --format json >/dev/null
docker run --rm \
  -v "$DATA_DIR:/app/data" \
  -e "HOME=$PROFILE_CONTAINER" \
  -e "USERPROFILE=$PROFILE_CONTAINER" \
  "$IMAGE" \
  dws minutes list all --limit 1 --format json >/dev/null

echo "[4/4] update manager-to-profile mapping"
python3 - "$PROFILES_FILE" "$MANAGER_USER_ID" "$PROFILE_CONTAINER" <<'PY'
import json
import os
import sys
import tempfile

path, user_id, profile = sys.argv[1:4]
data = {}
if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as fh:
        loaded = json.load(fh)
    if not isinstance(loaded, dict):
        raise SystemExit("profiles file must contain a JSON object")
    data.update(loaded)
data[user_id] = profile
parent = os.path.dirname(path)
os.makedirs(parent, exist_ok=True)
fd, tmp = tempfile.mkstemp(prefix=".dws-minutes-profiles.", dir=parent, text=True)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
finally:
    if os.path.exists(tmp):
        os.unlink(tmp)
PY

echo "[ok] $INSTANCE manager profile is ready: $MANAGER_USER_ID"
