/**
 * Root URL (`/`) landing for browsers and DingTalk webviews.
 * `/health` stays plain `ok` for probes; do not use `/` as the only health check if you need strict plain text.
 */
export function renderWorkbenchRootLandingHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>任务规划工作台</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.55; color: #222; }
    code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.92em; }
    ul { padding-left: 1.25rem; }
    .muted { color: #555; font-size: 0.95rem; }
  </style>
</head>
<body>
  <h1>任务规划工作台</h1>
  <p>这是站点<strong>首页</strong>。业务页面需要服务端签发的 <code>token</code>（HMAC），不能只填域名根路径。</p>
  <p class="muted">若旧版本在这里只看到「ok」，那是探活响应；请使用下方路径或机器人消息里的完整链接。</p>
  <h2>可用路径（均需 <code>?token=...</code>）</h2>
  <ul>
    <li><code>/workbench/manager</code> — 主管分配与追踪</li>
    <li><code>/workbench/employee</code> — 员工我的任务</li>
    <li><code>/workbench/conversation</code> — 任务对话中心</li>
    <li><code>/workbench/in-progress</code> — 进行中任务</li>
    <li><code>/assignment/workbench</code> — 兼容入口（分配工作台）</li>
  </ul>
  <p><strong>钉钉网页应用</strong>：开放平台里的首页 URL 不要只填 <code>https://域名/</code>；请填机器人推送的<strong>完整 HTTPS 链接</strong>（含 token），或后续接入钉钉免登后再用固定首页。</p>
  <p class="muted">探活：<a href="/health">/health</a> 返回纯文本 <code>ok</code>。</p>
</body>
</html>`;
}
