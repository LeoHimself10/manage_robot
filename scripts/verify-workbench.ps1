# Remote smoke test: HTML + API after test login (requires WORKBENCH_TEST_LOGIN_ENABLED=1 on server).
param(
  [string]$Base = "http://127.0.0.1:8080"
)

$ErrorActionPreference = "Stop"
$tmp = Join-Path $env:TEMP "wb-verify-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  foreach ($r in @(
      @{ u = "manager-test-1"; r = "manager"; f = "cookie-mgr.txt" },
      @{ u = "admin-test-1"; r = "admin"; f = "cookie-adm.txt" },
      @{ u = "manager-test-1"; r = "employee"; f = "cookie-emp.txt" }
    )) {
    $cf = Join-Path $tmp $r.f
    curl.exe -sS -c $cf -X POST "$Base/api/workbench/login" `
      -H "Content-Type: application/json" `
      -d (ConvertTo-Json @{ userId = $r.u; role = $r.r })
  }

  $mgrHtml = curl.exe -sS -b (Join-Path $tmp "cookie-mgr.txt") "$Base/workbench/manager/tasks"
  if ($mgrHtml -notmatch "async function loadTasks\(") { throw "manager loadTasks missing" }
  if ($mgrHtml -match "/api/workbench/me") { throw "manager 当前身份按钮未删" }

  $admHtml = curl.exe -sS -b (Join-Path $tmp "cookie-adm.txt") "$Base/workbench/admin"
  if ($admHtml -notmatch "getElementById\('saveManagerBtn'\)\.addEventListener") { throw "admin saveManagerBtn missing" }

  $empHtml = curl.exe -sS -b (Join-Path $tmp "cookie-emp.txt") "$Base/workbench/employee/current"
  if ($empHtml -match 'href="/workbench/employee/current\?tab=progress"') { throw "employee nav still has progress deep-link" }
  if ($empHtml -match 'href="/workbench/employee/current\?tab=profile"') { throw "employee nav still has profile deep-link" }
  if ($empHtml -notmatch 'id="empTabProgress"') { throw "employee inner tab empTabProgress missing" }

  foreach ($call in @(
      @{ url = "$Base/api/workbench/manager/tasks"; cookie = "cookie-mgr.txt" },
      @{ url = "$Base/api/workbench/admin/tasks"; cookie = "cookie-adm.txt" },
      @{ url = "$Base/api/workbench/employee/tasks/current"; cookie = "cookie-emp.txt" }
    )) {
    $body = curl.exe -sS -b (Join-Path $tmp $call.cookie) $call.url
    if ($body -notmatch '"ok":true') { throw "api $($call.url) not ok: $body" }
    if ($body -notmatch '"tasks":') { throw "api $($call.url) missing tasks field: $body" }
  }

  Write-Host "all checks passed ($Base)"
}
finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
