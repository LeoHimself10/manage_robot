import { getDingTalkCorpId } from "../integrations/dingtalk/dingtalk-auth";
import {
  EXTERNAL_WORKBENCH_LOGIN_PATH,
  isWorkbenchExternalLoginEnabled,
} from "./external-workbench-login";

/** Minimal tokens + login shell (standalone pages without full workbench CSS). */
export const WORKBENCH_LOGIN_SHELL_CSS = `
:root {
  --bg: #f1f5f9;
  --surface: #ffffff;
  --border: #e2e8f0;
  --text: #0f172a;
  --muted: #64748b;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --primary-soft: #eff6ff;
  --radius: 12px;
  --radius-sm: 8px;
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08);
  --font: "DM Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
  --text-sm: 13px;
  --text-base: 14px;
  --text-xl: 24px;
  --touch-min: 44px;
}
* { box-sizing: border-box; }
body.wb-login-page {
  margin: 0;
  min-height: 100vh;
  min-height: 100dvh;
  font-family: var(--font);
  background: linear-gradient(160deg, #eef2f6 0%, #f8fafc 45%, #eff6ff 100%);
  color: var(--text);
  line-height: 1.55;
}
.wb-login-wrap { max-width: 440px; margin: 0 auto; padding: 32px 18px 48px; padding-top: max(32px, env(safe-area-inset-top)); }
.wb-login-hero { text-align: center; margin-bottom: 20px; }
.wb-login-mark {
  width: 52px; height: 52px; margin: 0 auto 12px; border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #60a5fa); color: #fff;
  display: grid; place-items: center; font-size: 22px; font-weight: 800; box-shadow: var(--shadow-md);
}
.wb-login-hero h1 { margin: 0 0 6px; font-size: var(--text-xl); letter-spacing: -0.02em; }
.wb-login-hero p { margin: 0; color: var(--muted); font-size: var(--text-base); }
.wb-login-card {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow-md); padding: 20px;
}
.wb-login-card label { display: grid; gap: 6px; margin: 10px 0; font-size: var(--text-sm); font-weight: 500; }
.wb-login-card input, .wb-login-card select {
  padding: 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); font: inherit; font-size: 16px;
}
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 10px 16px; border-radius: var(--radius-sm); font-size: var(--text-base); font-weight: 600;
  cursor: pointer; border: 1px solid transparent; font-family: inherit;
}
.btn-primary { background: var(--primary); color: #fff; border-color: var(--primary-hover); width: 100%; margin-top: 12px; min-height: var(--touch-min); }
.muted { color: var(--muted); font-size: var(--text-sm); margin-top: 10px; min-height: 1.2em; }
.wb-login-spinner {
  width: 28px; height: 28px; border: 3px solid #e2e8f0; border-top-color: var(--primary);
  border-radius: 50%; animation: wb-spin 0.8s linear infinite; margin: 12px auto;
}
@keyframes wb-spin { to { transform: rotate(360deg); } }
a { color: var(--primary); }
.wb-login-alt-entry { margin-top: 18px; text-align: center; font-size: var(--text-sm); }
`;

function isWorkbenchTestLoginEnabled(): boolean {
  const raw = String(process.env.WORKBENCH_TEST_LOGIN_ENABLED ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** DingTalk auto-login entry (`/` and `/workbench` when unauthenticated). */
export function renderWorkbenchDingTalkEntryHtml(): string {
  const corpId = getDingTalkCorpId() ?? "";
  const testLoginEnabled = isWorkbenchTestLoginEnabled();
  const loginFormHtml = testLoginEnabled
    ? `<label>钉钉 userId
    <input id="userId" placeholder="例如 641871342" />
  </label>
  <label>身份
    <select id="role">
      <option value="auto">自动判定（推荐）</option>
      <option value="admin">管理员</option>
      <option value="manager">主管</option>
      <option value="employee">员工</option>
    </select>
  </label>
  <button id="loginBtn" type="button" class="btn btn-primary">登录工作台</button>`
    : `<div class="muted">请在钉钉工作台中打开本应用，将自动完成登录。</div>`;
  const externalLoginFooter = isWorkbenchExternalLoginEnabled()
    ? `<p class="muted wb-login-alt-entry">非钉钉用户？<a href="${EXTERNAL_WORKBENCH_LOGIN_PATH}">外部执行者登录</a></p>`
    : "";
  const heroHint = testLoginEnabled
    ? "钉钉内将自动免登；无法自动登录时可使用下方入口。"
    : "钉钉内打开将自动免登，并按身份进入对应工作台。";
  const initialResult = testLoginEnabled ? "正在尝试钉钉免登…" : "正在为您连接钉钉账号…";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>任务规划工作台</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${WORKBENCH_LOGIN_SHELL_CSS}</style>
</head>
<body class="wb-login-page">
<main class="wb-login-wrap">
  <div class="wb-login-hero">
    <div class="wb-login-mark" aria-hidden="true">任</div>
    <h1>任务规划工作台</h1>
    <p>${heroHint}</p>
  </div>
  <div class="wb-login-card">
  <div class="wb-login-spinner" id="loginSpinner" aria-hidden="true"></div>
  <div class="muted" id="ssoHint"></div>
  ${loginFormHtml}
  <div class="muted" id="result">${initialResult}</div>
  </div>
  ${externalLoginFooter}
</main>
<script>
window.__WB_CONFIGURED_CORP_ID = ${JSON.stringify(corpId)};
window.__WB_TEST_LOGIN_ENABLED = ${testLoginEnabled ? "true" : "false"};
</script>
<script src="/static/workbench-dd-login.js?v=next-redirect-20260709"></script>
<script>
(function () {
  const btn = document.getElementById('loginBtn');
  function setResult(msg) {
    var result = document.getElementById('result');
    if (result) result.textContent = msg;
  }
  function readNextPath() {
    try {
      var next = new URLSearchParams(window.location.search).get('next');
      if (next && next.indexOf('/workbench/') === 0 && next.indexOf('\\\\') === -1 && next.indexOf('//') === -1) {
        return next;
      }
    } catch (e) {}
    if (window.location.pathname && window.location.pathname !== '/workbench') {
      return window.location.pathname + window.location.search;
    }
    return '';
  }
  if (typeof window.__wbTryDingTalkLogin === 'function') {
    void window.__wbTryDingTalkLogin();
  } else {
    setResult('登录脚本未加载，请刷新或联系管理员运行 npm run build:workbench-login');
  }
  if (btn) {
    btn.addEventListener('click', async function () {
      const userId = (document.getElementById('userId').value || '').trim();
      const role = document.getElementById('role').value;
      if (!userId) {
        setResult('请填写 userId');
        return;
      }
      setResult('登录中...');
      try {
        const next = readNextPath();
        const res = await fetch('/api/workbench/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role, next }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          throw new Error(data.error || ('HTTP ' + res.status));
        }
        window.location.href = data.redirectTo || '/workbench';
      } catch (err) {
        setResult('登录失败：' + (err && err.message ? err.message : String(err)));
      }
    });
  }
})();
</script>
</body>
</html>`;
}

/** @deprecated Use renderWorkbenchDingTalkEntryHtml — root URL serves auto-login, not a menu. */
export function renderWorkbenchLandingPageHtml(): string {
  return renderWorkbenchDingTalkEntryHtml();
}
