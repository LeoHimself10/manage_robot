#!/usr/bin/env bash
# Run ON a host that can reach the workbench HTTP port (e.g. ECS: curl http://127.0.0.1:8080).
# Requires WORKBENCH_TEST_LOGIN_ENABLED=1 and whitelisted test userIds matching the plan.
set -euo pipefail
BASE="${1:-http://127.0.0.1:8080}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -sS -c "$TMP/mgr" -X POST "$BASE/api/workbench/login" \
  -H "Content-Type: application/json" \
  -d '{"userId":"manager-test-1","role":"manager"}'
curl -sS -c "$TMP/adm" -X POST "$BASE/api/workbench/login" \
  -H "Content-Type: application/json" \
  -d '{"userId":"admin-test-1","role":"admin"}'
curl -sS -c "$TMP/emp" -X POST "$BASE/api/workbench/login" \
  -H "Content-Type: application/json" \
  -d '{"userId":"manager-test-1","role":"employee"}'

M="$(curl -sS -b "$TMP/mgr" "$BASE/workbench/manager/tasks")"
echo "$M" | grep -q "async function loadTasks" || { echo "fail: manager loadTasks missing"; exit 1; }
if echo "$M" | grep -q "/api/workbench/me"; then echo "fail: manager 当前身份按钮未删"; exit 1; fi

A="$(curl -sS -b "$TMP/adm" "$BASE/workbench/admin")"
echo "$A" | grep -Fq "saveManagerBtn').addEventListener" \
  || { echo "fail: admin saveManagerBtn missing"; exit 1; }

E="$(curl -sS -L -b "$TMP/emp" "$BASE/workbench/employee?view=current")"
if echo "$E" | grep -q 'href="/workbench/employee/current?tab=progress"'; then echo "fail: employee nav still links tab=progress"; exit 1; fi
if echo "$E" | grep -q 'href="/workbench/employee/current?tab=profile"'; then echo "fail: employee nav still links tab=profile"; exit 1; fi
echo "$E" | grep -q 'id="panelCur"' || { echo "fail: employee panelCur missing"; exit 1; }

curl -sS -b "$TMP/mgr" "$BASE/api/workbench/manager/tasks" | grep -q '"ok":true' || { echo "fail: manager tasks API"; exit 1; }
curl -sS -b "$TMP/mgr" "$BASE/api/workbench/manager/tasks" | grep -q '"tasks"' || { echo "fail: manager tasks field"; exit 1; }

curl -sS -b "$TMP/adm" "$BASE/api/workbench/admin/tasks" | grep -q '"ok":true' || { echo "fail: admin tasks API"; exit 1; }
curl -sS -b "$TMP/adm" "$BASE/api/workbench/admin/tasks" | grep -q '"tasks"' || { echo "fail: admin tasks field"; exit 1; }

curl -sS -b "$TMP/emp" "$BASE/api/workbench/employee/tasks/current" | grep -q '"ok":true' || { echo "fail: employee tasks/current API"; exit 1; }
curl -sS -b "$TMP/emp" "$BASE/api/workbench/employee/tasks/current" | grep -q '"tasks"' || { echo "fail: employee tasks field"; exit 1; }

echo "all checks passed ($BASE)"
