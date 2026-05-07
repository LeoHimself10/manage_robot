# Requires: PowerShell 5+ on Windows
# SSH with .pem to Aliyun ECS, clone or pull /opt/manage_robot.
#
# Public repo:
#   .\scripts\ecs-login-clone.ps1 -PublicIp 47.243.199.153 -PemPath "$env:USERPROFILE\Downloads\hh.pem"
#
# Private GitHub repo (fine-grained or classic PAT with Contents: Read):
#   .\scripts\ecs-login-clone.ps1 -PublicIp ... -PemPath ... -GitHubPat "ghp_xxxx"
#
# If root login fails:
#   .\scripts\ecs-login-clone.ps1 -PublicIp ... -PemPath ... -RemoteUser ecs-user

param(
  [Parameter(Mandatory = $true)]
  [string]$PublicIp,

  [Parameter(Mandatory = $false)]
  [string]$PemPath = "$env:USERPROFILE\Downloads\hh.pem",

  [Parameter(Mandatory = $false)]
  [string]$RemoteUser = "root",

  [Parameter(Mandatory = $false)]
  [string]$GitUrl = "https://github.com/LeoHimself10/manage_robot.git",

  [Parameter(Mandatory = $false)]
  [string]$GitHubPat = ""
)

$ErrorActionPreference = "Stop"

function Build-GitHubHttpsCloneUrl {
  param(
    [string]$GitUrl,
    [string]$Token
  )
  $u = [Uri]$GitUrl
  if ($u.Scheme -ne "https") {
    throw "With -GitHubPat, GitUrl must be https (got $($u.Scheme))"
  }
  if ($u.Host -ne "github.com") {
    throw "With -GitHubPat, GitUrl host must be github.com (got $($u.Host))"
  }
  $path = $u.AbsolutePath
  if (-not $path.EndsWith(".git")) {
    $path = "$path.git"
  }
  $enc = [Uri]::EscapeDataString($Token)
  return "https://x-access-token:${enc}@github.com${path}"
}

if (-not (Test-Path -LiteralPath $PemPath)) {
  Write-Error "PEM file not found: $PemPath"
}

$cloneUrl = $GitUrl
if ($GitHubPat) {
  $cloneUrl = Build-GitHubHttpsCloneUrl -GitUrl $GitUrl -Token $GitHubPat
  Write-Host "Auth: GitHub PAT (token not printed)."
} else {
  Write-Host "Auth: none - works only if the Git repo is public."
}

icacls $PemPath /inheritance:r | Out-Null
icacls $PemPath /grant:r "${env:USERNAME}:R" | Out-Null

$sshTarget = "${RemoteUser}@${PublicIp}"

$urlB64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($cloneUrl))

$remoteBash = @'
set -e
if ! command -v git >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y git
fi
sudo mkdir -p /opt
sudo chown "$(whoami):$(whoami)" /opt 2>/dev/null || true
cd /opt
if [ -d manage_robot ] && [ ! -d manage_robot/.git ]; then
  rm -rf manage_robot
fi
if [ -d manage_robot/.git ]; then
  cd manage_robot && git pull --ff-only
else
  GIT_CLONE_URL=$(printf '%s' '__URLB64__' | base64 -d)
  git clone "$GIT_CLONE_URL" manage_robot
fi
cd /opt/manage_robot && pwd && git rev-parse --short HEAD && git remote -v | head -n 2
'@.Replace("__URLB64__", $urlB64)

$remoteBash = ($remoteBash -replace "`r", "").TrimEnd() + "`n"
$b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteBash))

Write-Host "SSH -> $sshTarget"
Write-Host "Repo (no secrets): $GitUrl"

$remoteShell = "echo $b64 | base64 -d | bash"
ssh `
  -i $PemPath `
  -o StrictHostKeyChecking=accept-new `
  $sshTarget `
  $remoteShell

Write-Host ""
Write-Host "Done. Next on server: install Docker, build image, docker run (docs/deploy-aliyun-dingtalk.md sections 2.2-2.4)."
