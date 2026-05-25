# SSH 到 ECS：`git pull` + 重建并后台启动钉钉 Bot 容器（密钥在主机 --env-file，勿写入镜像）。
# 顺序：pull → build（旧容器仍服务）→ stop/rm → run → health，避免「只拆不装」空窗。
#
#   .\scripts\ecs-deploy-dingtalk.ps1 -PublicIp <你的ECS公网IP> -PemPath "$env:USERPROFILE\Downloads\hh.pem"
#
param(
  [Parameter(Mandatory = $true)]
  [string]$PublicIp,

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

if (-not (Test-Path -LiteralPath $PemPath)) {
  Write-Error "PEM file not found: $PemPath"
}

icacls $PemPath /inheritance:r | Out-Null
icacls $PemPath /grant:r "${env:USERNAME}:R" | Out-Null

$sshTarget = "${RemoteUser}@${PublicIp}"

$remoteBash = @'
set -euo pipefail
cd __REPODIR__

CONTAINER=manage-robot-dingtalk
IMAGE=manage-robot:dingtalk
PORT=__PORT__
ENVFILE=__ENVFILE__
DATADIR=__DATADIR__

run_container() {
  mkdir -p "$DATADIR/sessions" "$DATADIR/events" "$DATADIR/plans"
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    --env-file "$ENVFILE" \
    -v "$DATADIR:/app/data" \
    -p "${PORT}:8080" \
    "$IMAGE"
}

recover_if_down() {
  if docker ps -q -f "name=^/${CONTAINER}$" | grep -q .; then
    return 0
  fi
  echo "[deploy] ERROR: $CONTAINER not running — attempting recovery docker run with $IMAGE ..."
  docker rm -f "$CONTAINER" 2>/dev/null || true
  run_container || true
}

trap 'recover_if_down' ERR

echo "[deploy] git pull ..."
git pull --ff-only

echo "[deploy] docker build (old container keeps serving until swap) ..."
docker build -t "$IMAGE" .

echo "[deploy] swap container ..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true
run_container

echo "[deploy] wait for /health ..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "[deploy] health ok"
    docker ps --filter "name=$CONTAINER"
    docker logs --tail 20 "$CONTAINER"
    exit 0
  fi
  sleep 2
done

echo "[deploy] FATAL: /health not ready after 60s"
docker logs --tail 50 "$CONTAINER" || true
exit 1
'@
$remoteBash = $remoteBash.Replace("__REPODIR__", $RepoDir)
$remoteBash = $remoteBash.Replace("__ENVFILE__", $EnvFile)
$remoteBash = $remoteBash.Replace("__PORT__", $PublishPort)
$remoteBash = $remoteBash.Replace("__DATADIR__", $DataDir)
$remoteBash = ($remoteBash -replace "`r", "").TrimEnd() + "`n"
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteBash))

Write-Host "SSH -> $sshTarget"
Write-Host "Repo: $RepoDir ; env-file: $EnvFile ; port: $PublishPort"
Write-Host "Data dir: $DataDir"

ssh `
  -i $PemPath `
  -o StrictHostKeyChecking=accept-new `
  -o ServerAliveInterval=30 `
  -o ServerAliveCountMax=120 `
  $sshTarget `
  "echo $b64 | base64 -d | bash"

if ($LASTEXITCODE -ne 0) {
  Write-Error "Remote deploy failed (exit $LASTEXITCODE). Check ECS: docker ps -a; curl http://127.0.0.1:${PublishPort}/health"
}

Write-Host "Done."
