# Run multi-scenario agent smoke on ECS from Windows PowerShell (SSH + Docker).
# Does NOT start DingTalk; only calls Qwen via scripts/run-qwen-scenarios.ts inside the image.
#
# Prerequisites on ECS: Docker installed; repo at /opt/manage_robot (or set -RepoDir).
#
# Usage:
#   .\scripts\cloud-agent-smoke.ps1 `
#     -PublicIp 47.243.199.153 `
#     -PemPath "$env:USERPROFILE\Downloads\hh.pem" `
#     -QwenApiKey "sk-...."
#
# Skip image rebuild when image is already up to date:
#   .\scripts\cloud-agent-smoke.ps1 ... -QwenApiKey "..." -SkipDockerBuild

param(
  [Parameter(Mandatory = $true)]
  [string]$PublicIp,

  [Parameter(Mandatory = $false)]
  [string]$PemPath = "$env:USERPROFILE\Downloads\hh.pem",

  [Parameter(Mandatory = $true)]
  [string]$QwenApiKey,

  [Parameter(Mandatory = $false)]
  [string]$QwenModel = "qwen3.6-plus",

  [Parameter(Mandatory = $false)]
  [string]$RemoteUser = "root",

  [Parameter(Mandatory = $false)]
  [string]$RepoDir = "/opt/manage_robot",

  [switch]$SkipDockerBuild
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $PemPath)) {
  Write-Error "PEM file not found: $PemPath"
}

$keyB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($QwenApiKey))
$modelB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($QwenModel))
$skipFlag = if ($SkipDockerBuild) { "1" } else { "0" }

$remoteBash = @'
set -e
cd __REPODIR__
git pull --ff-only || true
if [ "__SKIPBUILD__" != "1" ]; then
  docker build -t manage-robot:dingtalk .
fi
KEY="$(printf '%s' '__KEYB64__' | base64 -d)"
MODEL="$(printf '%s' '__MODELB64__' | base64 -d)"
docker run --rm -e QWEN_API_KEY="$KEY" -e QWEN_MODEL="$MODEL" manage-robot:dingtalk npx tsx scripts/run-qwen-scenarios.ts
'@
$remoteBash = $remoteBash.Replace("__REPODIR__", $RepoDir).Replace("__SKIPBUILD__", $skipFlag).Replace("__KEYB64__", $keyB64).Replace("__MODELB64__", $modelB64)

$remoteBash = ($remoteBash -replace "`r", "").TrimEnd() + "`n"
$outerB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteBash))

icacls $PemPath /inheritance:r | Out-Null
icacls $PemPath /grant:r "${env:USERNAME}:R" | Out-Null

$sshTarget = "${RemoteUser}@${PublicIp}"
Write-Host "SSH -> $sshTarget"
Write-Host "Repo dir: $RepoDir"
Write-Host "Qwen model: $QwenModel"
Write-Host "Scenarios: scripts/run-qwen-scenarios.ts (S1-S6 incl. NEEDS_MORE_INFO cases)"
Write-Host "Skip docker build: $SkipDockerBuild"

$remoteShell = "echo $outerB64 | base64 -d | bash"
ssh `
  -i $PemPath `
  -o StrictHostKeyChecking=accept-new `
  $sshTarget `
  $remoteShell

Write-Host ""
Write-Host "Done. Expect JSON lines per scenario plus final summary.tallies."
