#!/bin/sh
set -e
cd /app

export EMPLOYEE_FIXTURE_SOURCE="${EMPLOYEE_FIXTURE_SOURCE:-/app/fixtures/employees-seed.json}"
export EMPLOYEE_PROFILE_DIR="${EMPLOYEE_PROFILE_DIR:-./data/employees/profiles}"

mkdir -p "$EMPLOYEE_PROFILE_DIR" ./data/plans ./data/events ./data/cards 2>/dev/null || true

if [ -f "$EMPLOYEE_FIXTURE_SOURCE" ]; then
  npx tsx scripts/seed-employee-profiles.ts
else
  echo "[entrypoint] WARN: missing $EMPLOYEE_FIXTURE_SOURCE — assignment recommender may have no candidates"
fi

exec npx tsx src/dingtalk-bot.ts
