# Sync local follow-up code to ECS, enable FOLLOWUP_* env, rebuild dingtalk container.
#
#   .\scripts\ecs-deploy-followup.ps1 -PublicIp 47.243.199.153 -PemPath "$env:USERPROFILE\Downloads\hh.pem"
#
param(
  [Parameter(Mandatory = $false)]
  [string]$PublicIp = "47.243.199.153",

  [Parameter(Mandatory = $false)]
  [string]$PemPath = "$env:USERPROFILE\Downloads\hh.pem",

  [Parameter(Mandatory = $false)]
  [string]$RemoteUser = "root",

  [Parameter(Mandatory = $false)]
  [string]$RepoDir = "/opt/manage_robot",

  [Parameter(Mandatory = $false)]
  [string]$EnvFile = "/etc/manage-robot.env",

  [Parameter(Mandatory = $false)]
  [string]$PublishPort = "8080",

  [Parameter(Mandatory = $false)]
  [string]$DataDir = "/opt/manage_robot/data"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path -LiteralPath $PemPath)) {
  Write-Error "PEM file not found: $PemPath"
}

icacls $PemPath /inheritance:r | Out-Null
icacls $PemPath /grant:r "${env:USERNAME}:R" | Out-Null

$sshTarget = "${RemoteUser}@${PublicIp}"
$sshOpts = @("-i", $PemPath, "-o", "StrictHostKeyChecking=accept-new")

Write-Host "==> Sync project files to ${sshTarget}:${RepoDir}"
ssh @sshOpts $sshTarget "mkdir -p $RepoDir/scripts"
$syncItems = @(
  "src", "tests", "scripts", "docs", "AGENTS.md", ".env.example",
  "package.json", "package-lock.json", "tsconfig.json",
  "Dockerfile", ".dockerignore", "vitest.setup.ts", "vitest.config.ts"
)
foreach ($item in $syncItems) {
  $local = Join-Path $ProjectRoot $item
  if (-not (Test-Path -LiteralPath $local)) { continue }
  Write-Host "  scp $item"
  scp @sshOpts -r $local "${sshTarget}:${RepoDir}/"
}

$remoteBash = @'
set -euo pipefail
ENV_FILE="__ENVFILE__"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE" 2>/dev/null || true
set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$val" >>"$ENV_FILE"
  fi
}
set_kv FOLLOWUP_REMINDER_ENABLED 1
set_kv FOLLOWUP_SCAN_INTERVAL_MS 300000
set_kv FOLLOWUP_TIMEZONE Asia/Shanghai
set_kv FOLLOWUP_WEEKDAYS_ONLY 1
set_kv FOLLOWUP_PRE_DUE_HOUR 10
set_kv FOLLOWUP_PRE_DUE_MINUTE 0
set_kv FOLLOWUP_TIER2_AFTER_OVERDUE_DAYS 1
set_kv FOLLOWUP_QUIET_HOURS 22:00-08:00
set_kv FOLLOWUP_MANUAL_LLM_ENABLED 1
set_kv FOLLOWUP_MANUAL_LLM_TIMEOUT_MS 5000
set_kv PROGRESS_DIGEST_ENABLED 1
set_kv PROGRESS_DIGEST_MODE delivery_reminder
set_kv PROGRESS_DIGEST_HORIZON_DAYS 7
set_kv PROGRESS_DIGEST_SCAN_INTERVAL_MS 300000
set_kv PROGRESS_DIGEST_TIMEZONE Asia/Shanghai
set_kv PROGRESS_DIGEST_HOUR 9
set_kv PROGRESS_DIGEST_MINUTE 0
set_kv PROGRESS_DIGEST_WEEKDAYS_ONLY 1
set_kv PROGRESS_DIGEST_MAX_TASK_LINES 8
set_kv PROGRESS_DIGEST_LLM_ENABLED 0
set_kv PROGRESS_DIGEST_LLM_MODEL qwen3.6-flash
set_kv PROGRESS_DIGEST_LLM_TIMEOUT_MS 8000
set_kv PROGRESS_DIGEST_LLM_MAX_TOKENS 800
set_kv WORKBENCH_DINGTALK_NOTIFY_ENABLED 1
echo "--- follow-up + digest env ---"
grep -E '^(FOLLOWUP_|PROGRESS_DIGEST_|WORKBENCH_DINGTALK_NOTIFY_ENABLED)=' "$ENV_FILE" || true
cd __REPODIR__
docker stop manage-robot-dingtalk 2>/dev/null || true
docker rm manage-robot-dingtalk 2>/dev/null || true
docker build -t manage-robot:dingtalk .
mkdir -p __DATADIR__/sessions __DATADIR__/events __DATADIR__/plans __DATADIR__/workbench
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file __ENVFILE__ \
  -v __DATADIR__:/app/data \
  -p __PORT__:8080 \
  manage-robot:dingtalk
sleep 3
docker ps --filter name=manage-robot-dingtalk
echo "--- FOLLOWUP + DIGEST env in container ---"
docker exec manage-robot-dingtalk sh -c 'echo FOLLOWUP_REMINDER_ENABLED=$FOLLOWUP_REMINDER_ENABLED FOLLOWUP_PRE_DUE_HOUR=$FOLLOWUP_PRE_DUE_HOUR; echo PROGRESS_DIGEST_ENABLED=$PROGRESS_DIGEST_ENABLED; echo WORKBENCH_DINGTALK_NOTIFY_ENABLED=$WORKBENCH_DINGTALK_NOTIFY_ENABLED' 2>/dev/null || true
docker logs --tail 25 manage-robot-dingtalk
'@
$remoteBash = $remoteBash.Replace("__REPODIR__", $RepoDir)
$remoteBash = $remoteBash.Replace("__ENVFILE__", $EnvFile)
$remoteBash = $remoteBash.Replace("__PORT__", $PublishPort)
$remoteBash = $remoteBash.Replace("__DATADIR__", $DataDir)
$remoteBash = ($remoteBash -replace "`r", "").TrimEnd() + "`n"
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteBash))

Write-Host "==> Patch env + rebuild container"
ssh @sshOpts $sshTarget "echo $b64 | base64 -d | bash"

Write-Host "Done. Verify: docker logs -f manage-robot-dingtalk (look for reminder scheduler start)."
