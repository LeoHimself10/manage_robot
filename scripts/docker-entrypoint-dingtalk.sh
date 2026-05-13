#!/bin/sh
set -e
cd /app

export EMPLOYEE_FIXTURE_SOURCE="${EMPLOYEE_FIXTURE_SOURCE:-/app/fixtures/employees-seed.json}"
export EMPLOYEE_PROFILE_DIR="${EMPLOYEE_PROFILE_DIR:-./data/employees/profiles}"

mkdir -p "$EMPLOYEE_PROFILE_DIR" ./data/plans ./data/events ./data/cards 2>/dev/null || true

# Demo seed（fixtures/employees-seed.json）默认不再写入：
#   - 生产/钉钉同步链路下会把 10 个虚构画像与真实 366 人混在一起，让 search_employees 优先推假人。
#   - 仅在 SEED_DEMO_EMPLOYEES=1 时显式开启（本地 demo / eval 用）。
if [ "${SEED_DEMO_EMPLOYEES}" = "1" ] && [ -f "$EMPLOYEE_FIXTURE_SOURCE" ]; then
  echo "[entrypoint] SEED_DEMO_EMPLOYEES=1 — importing $EMPLOYEE_FIXTURE_SOURCE"
  npx tsx scripts/seed-employee-profiles.ts
else
  echo "[entrypoint] demo seed skipped (set SEED_DEMO_EMPLOYEES=1 to enable)"
fi

exec npx tsx src/dingtalk-bot.ts
