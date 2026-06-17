#!/usr/bin/env bash
# Read-only ECS instance facts for docs/deploy-managebot-vs-mingsibot.md
set -eu

echo "## docker"
docker ps -a --format '{{.Names}}|{{.Status}}|{{.Ports}}' | grep manage-robot || true

echo "## caddy"
docker exec manage-robot-caddy cat /etc/caddy/Caddyfile 2>/dev/null | grep -E 'vivolightsales|127.0.0.1' || true

inspect_env() {
  local name="$1" file="$2"
  echo "## env_file $file"
  for k in DAILY_REPORT_DIGEST_ENABLED DAILY_REPORT_DIGEST_CONFIG_FILE DAILY_REPORTS_PAGE_ENABLED DAILY_REPORT_PROJECT_VIEWS_ENABLED MEETING_IMPORT_ENABLED ASSIGNMENT_WEB_PUBLIC_BASE_URL ASSIGNMENT_WEB_PORT HEALTH_CHECK_PORT WORKBENCH_SQLITE_PATH; do
    if grep -q "^${k}=" "$file" 2>/dev/null; then
      grep "^${k}=" "$file" | sed 's/=.*$/=<set>/'
    else
      echo "${k}=<unset in file>"
    fi
  done
}

inspect_env managebot /etc/manage-robot.env
inspect_env mingsibot /etc/manage-robot-mingsibot.env

for c in manage-robot-dingtalk manage-robot-mingsibot; do
  echo "## container_runtime $c"
  docker exec "$c" printenv DAILY_REPORT_DIGEST_ENABLED DAILY_REPORT_DIGEST_CONFIG_FILE DAILY_REPORTS_PAGE_ENABLED DAILY_REPORT_PROJECT_VIEWS_ENABLED MEETING_IMPORT_ENABLED ASSIGNMENT_WEB_PUBLIC_BASE_URL ASSIGNMENT_WEB_PORT HEALTH_CHECK_PORT 2>/dev/null || true
  docker exec "$c" test -f /app/data/daily-report-digest.config.json && echo "config_json=present" || echo "config_json=missing"
  docker exec "$c" wc -c /app/data/workbench.sqlite 2>/dev/null || echo "workbench.sqlite=missing"
done

echo "## mingsibot_config_summary"
docker exec manage-robot-mingsibot node - <<'NODE'
const fs = require("fs");
const p = "/app/data/daily-report-digest.config.json";
const c = JSON.parse(fs.readFileSync(p, "utf8"));
for (const o of c.orgs || []) {
  const emps = (o.employees || []).length;
  const pvs = (o.projectViews || []).map((v) => v.id).filter(Boolean);
  console.log(
    JSON.stringify({
      label: o.label,
      employees: emps,
      projectViews: pvs,
      useDeployedAppCredentials: !!o.useDeployedAppCredentials,
      hasOwnAppKey: !!(o.appKey && o.appSecret),
      projectFilter: Array.isArray(o.projectFilter) ? o.projectFilter.length : 0,
    }),
  );
}
console.log(
  JSON.stringify({
    webhookConfigured: !!(c.webhook && c.webhook.accessToken),
    sendHour: c.sendHour,
    sendMinute: c.sendMinute,
    reportDayCutoffHour: c.reportDayCutoffHour,
    timezone: c.timezone,
  }),
);
NODE

echo "## git"
cd /opt/manage_robot && git log -1 --oneline && git branch --show-current
