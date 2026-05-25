import type { WorkbenchSession } from "./assignment-workbench-session-types";

const EXTERNAL_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const EXTERNAL_LOGIN_MAX_ATTEMPTS = 5;
const externalLoginAttempts = new Map<string, { count: number; resetAt: number }>();

export function isWorkbenchExternalLoginEnabled(): boolean {
  const raw = String(process.env.WORKBENCH_EXTERNAL_LOGIN_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function shouldUseSecureWorkbenchCookies(): boolean {
  const raw = String(process.env.WORKBENCH_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  const base = process.env.ASSIGNMENT_WEB_PUBLIC_BASE_URL?.trim();
  return !!base && base.startsWith("https://");
}

export const EXTERNAL_WORKBENCH_LOGIN_PATH = "/workbench/external/login";
export const DEFAULT_WORKBENCH_LOGIN_PATH = "/workbench";

export function isExternalPasswordSession(session: Pick<WorkbenchSession, "loginSource">): boolean {
  return session.loginSource === "external_password";
}

export function resolveWorkbenchLogoutRedirect(
  loginSource?: WorkbenchSession["loginSource"],
): string {
  if (loginSource === "external_password") return EXTERNAL_WORKBENCH_LOGIN_PATH;
  return DEFAULT_WORKBENCH_LOGIN_PATH;
}

export function sanitizeWorkbenchNextPath(raw: string | null | undefined): string | undefined {
  const value = String(raw ?? "").trim();
  if (!value.startsWith("/workbench/employee")) return undefined;
  if (value.includes("\\") || value.includes("//")) return undefined;
  return value;
}

export function buildExternalLoginUrl(next?: string): string {
  const safe = sanitizeWorkbenchNextPath(next);
  if (!safe) return EXTERNAL_WORKBENCH_LOGIN_PATH;
  return `${EXTERNAL_WORKBENCH_LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
}

export function resolveWorkbenchSessionExpiredRedirect(
  loginSource?: WorkbenchSession["loginSource"],
  next?: string,
): string {
  if (loginSource === "external_password") return buildExternalLoginUrl(next);
  return DEFAULT_WORKBENCH_LOGIN_PATH;
}

export function readExternalLoginNextFromUrl(search: string): string {
  try {
    const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    return sanitizeWorkbenchNextPath(params.get("next")) ?? "/workbench/employee?view=new";
  } catch {
    return "/workbench/employee?view=new";
  }
}

export function externalLoginRateLimitKey(username: string, clientIp: string): string {
  return `${clientIp}|${String(username ?? "").trim().toLowerCase()}`;
}

export function checkExternalLoginRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = externalLoginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    externalLoginAttempts.set(key, { count: 1, resetAt: now + EXTERNAL_LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= EXTERNAL_LOGIN_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

export function resetExternalLoginRateLimit(key: string): void {
  externalLoginAttempts.delete(key);
}

export function renderExternalLoginHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>外部执行者登录</title>
<style>
body { font-family: system-ui, sans-serif; background: #f5f7fb; color: #0f172a; }
.wrap { max-width: 420px; margin: 48px auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; }
h1 { margin: 0 0 8px; font-size: 22px; }
p { color: #475569; margin: 0 0 16px; font-size: 14px; }
label { display: grid; gap: 6px; margin: 10px 0; font-size: 14px; }
input { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; font: inherit; }
button { margin-top: 12px; width: 100%; border: 1px solid #1d4ed8; background: #2563eb; color: #fff; border-radius: 8px; padding: 10px 12px; font-weight: 600; cursor: pointer; }
.muted { color: #64748b; font-size: 13px; margin-top: 12px; min-height: 1.2em; }
</style>
</head>
<body>
<main class="wrap">
  <h1>外部执行者登录</h1>
  <p>请使用管理员提供的账号密码登录员工工作台。</p>
  <label>账号
    <input id="username" autocomplete="username" />
  </label>
  <label>密码
    <input id="password" type="password" autocomplete="current-password" />
  </label>
  <button id="loginBtn" type="button">登录</button>
  <div class="muted" id="result"></div>
  <p class="muted" style="margin-top:16px;">钉钉用户请<a href="/workbench">前往钉钉免登入口</a>。</p>
</main>
<script>
(function () {
  const btn = document.getElementById('loginBtn');
  const result = document.getElementById('result');
  function readNextParam() {
    try {
      var n = new URLSearchParams(location.search).get('next');
      if (n && n.indexOf('/workbench/employee') === 0) return n;
    } catch (e) {}
    return '/workbench/employee?view=new';
  }
  function setResult(msg) { if (result) result.textContent = msg; }
  if (!btn) return;
  btn.addEventListener('click', async function () {
    const username = (document.getElementById('username').value || '').trim();
    const password = document.getElementById('password').value || '';
    const next = readNextParam();
    if (!username || !password) { setResult('请填写账号和密码'); return; }
    setResult('登录中...');
    try {
      const res = await fetch('/api/workbench/external/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, next }),
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      window.location.href = data.redirectTo || next;
    } catch (err) {
      setResult('登录失败：' + (err && err.message ? err.message : String(err)));
    }
  });
})();
</script>
</body>
</html>`;
}

export function __resetExternalLoginRateLimitsForTest(): void {
  externalLoginAttempts.clear();
}
