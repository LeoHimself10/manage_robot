# Build an isolated candidate image on ECS without touching the dirty production checkout
# or restarting either running container.
param(
  [string]$PublicIp = "47.243.199.153",
  [string]$PemPath = "$env:USERPROFILE\Downloads\hh.pem",
  [string]$RemoteUser = "root",
  [string]$Image = "manage-robot:dingtalk-unified-meetings",
  [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$tempRoot = [System.IO.Path]::GetFullPath(
  (Join-Path ([System.IO.Path]::GetTempPath()) ("manage-robot-unified-meetings-" + [guid]::NewGuid().ToString("N")))
)
$archive = "$tempRoot.tar.gz"
$remoteArchive = "/tmp/manage-robot-unified-meetings.tar.gz"
$sshTarget = "${RemoteUser}@${PublicIp}"

$overlayFiles = @(
  "Dockerfile",
  ".env.example",
  "docs/task-intake.md",
  "docs/unified-meeting-go-live.md",
  "src/dingtalk-bot.ts",
  "src/infra/dingtalk-meeting-store.ts",
  "src/integrations/dingtalk/meeting-events.ts",
  "src/integrations/dingtalk/dingtalk-minutes.ts",
  "src/web/task-intake-api.ts",
  "scripts/ecs-authorize-dingtalk-minutes.sh",
  "scripts/ecs-preflight-unified-meetings.sh",
  "scripts/ecs-activate-unified-meetings.sh"
)

if (-not (Test-Path -LiteralPath $PemPath)) {
  throw "PEM file not found: $PemPath"
}

try {
  if (-not $SkipTests) {
    Push-Location $repoRoot
    try {
      npm run typecheck
      if ($LASTEXITCODE -ne 0) { throw "typecheck failed" }
      npm test
      if ($LASTEXITCODE -ne 0) { throw "tests failed" }
    } finally {
      Pop-Location
    }
  }

  git clone --local --no-hardlinks --quiet $repoRoot $tempRoot
  if ($LASTEXITCODE -ne 0) { throw "clean release clone failed" }

  foreach ($relative in $overlayFiles) {
    $source = Join-Path $repoRoot $relative
    if (-not (Test-Path -LiteralPath $source)) {
      throw "release overlay missing: $relative"
    }
    $target = Join-Path $tempRoot $relative
    $targetDir = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $targetDir)) {
      New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $target -Force
  }

  tar -czf $archive --exclude=.git -C $tempRoot .
  if ($LASTEXITCODE -ne 0) { throw "release archive creation failed" }

  scp -i $PemPath -o StrictHostKeyChecking=accept-new $archive "${sshTarget}:${remoteArchive}"
  if ($LASTEXITCODE -ne 0) { throw "candidate archive upload failed" }

  $remoteScript = @'
set -euo pipefail
mkdir -p /opt/manage_robot-releases
release_dir="$(mktemp -d /opt/manage_robot-releases/unified-meetings.XXXXXX)"
tar -xzf __ARCHIVE__ -C "$release_dir"
chmod +x "$release_dir/scripts/ecs-authorize-dingtalk-minutes.sh"
chmod +x "$release_dir/scripts/ecs-preflight-unified-meetings.sh"
chmod +x "$release_dir/scripts/ecs-activate-unified-meetings.sh"
docker build -t __IMAGE__ "$release_dir"
docker run --rm __IMAGE__ dws --version
printf 'release_dir=%s\n' "$release_dir"
printf 'candidate_image=%s\n' '__IMAGE__'
'@
  $remoteScript = $remoteScript.Replace("__ARCHIVE__", $remoteArchive).Replace("__IMAGE__", $Image)
  $remoteScript = ($remoteScript -replace "`r", "").TrimEnd() + "`n"
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($remoteScript))
  ssh -i $PemPath -o StrictHostKeyChecking=accept-new $sshTarget "echo $encoded | base64 -d | bash"
  if ($LASTEXITCODE -ne 0) { throw "candidate image build failed" }
} finally {
  $safeTempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($tempRoot.StartsWith($safeTempBase, [System.StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $tempRoot) {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $archive) {
      Remove-Item -LiteralPath $archive -Force
    }
  }
}
