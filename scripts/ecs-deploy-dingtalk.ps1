# SSH 到 ECS：`git pull` + 重建并后台启动钉钉 Bot 容器（密钥在主机 --env-file，勿写入镜像）。
# 使用前请将下方默认 IP/密钥路径换成你自己的资源；示例值与 ecs-login-clone.ps1 一致。
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
git pull --ff-only
docker stop manage-robot-dingtalk 2>/dev/null || true
docker rm manage-robot-dingtalk 2>/dev/null || true
docker build -t manage-robot:dingtalk .
mkdir -p __DATADIR__/sessions __DATADIR__/events __DATADIR__/plans
docker run -d --name manage-robot-dingtalk --restart unless-stopped \
  --env-file __ENVFILE__ \
  -v __DATADIR__:/app/data \
  -p __PORT__:8080 \
  manage-robot:dingtalk
docker ps --filter name=manage-robot-dingtalk
docker logs --tail 30 manage-robot-dingtalk
'@
$remoteBash = (
  $remoteBash
    .Replace("__REPODIR__", $RepoDir)
    .Replace("__ENVFILE__", $EnvFile)
    .Replace("__PORT__", $PublishPort)
    .Replace("__DATADIR__", $DataDir)
)
$remoteBash = ($remoteBash -replace "`r", "").TrimEnd() + "`n"
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteBash))

Write-Host "SSH -> $sshTarget"
Write-Host "Repo: $RepoDir ; env-file: $EnvFile ; port: $PublishPort"
Write-Host "Data dir: $DataDir"

ssh `
  -i $PemPath `
  -o StrictHostKeyChecking=accept-new `
  $sshTarget `
  "echo $b64 | base64 -d | bash"

Write-Host "Done."
