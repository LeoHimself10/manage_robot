/**
 * Root URL (`/`) landing for browsers and DingTalk webviews.
 * `/health` stays plain `ok` for probes; do not use `/` as the only health check if you need strict plain text.
 */
import { isWorkbenchExternalLoginEnabled } from "./external-workbench-login";

export function renderWorkbenchRootLandingHtml(): string {
  const externalLoginItem = isWorkbenchExternalLoginEnabled()
    ? `    <li><code>/workbench/external/login</code> — 外部执行者 · 账号密码登录</li>\n`
    : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>任务规划工作台</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 2rem; line-height: 1.55; color: #222; }
    code { background: #f4f4f4; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.92em; word-break: break-all; }
    ul { padding-left: 1.1rem; margin: 0.5rem 0 0; }
    li { margin: 0.35rem 0; word-break: break-word; }
    h1 { font-size: 1.35rem; margin: 0 0 0.75rem; line-height: 1.25; }
    h2 { font-size: 1.05rem; margin: 1.25rem 0 0.5rem; }
    .muted { color: #555; font-size: 0.95rem; }
    @media (max-width: 480px) {
      body { padding: 0.75rem 0.75rem 1.5rem; }
      h1 { font-size: 1.2rem; }
    }
  </style>
</head>
<body>
  <h1>任务规划工作台</h1>
  <p>这是站点<strong>首页</strong>，可直接作为钉钉网页应用首页 URL 使用。</p>
  <p class="muted">在钉钉内打开将自动登录，并按主管/员工身份进入对应工作台。</p>
  <h2>可用路径（支持固定 URL 直达）</h2>
  <ul>
    <li><code>/workbench</code> — 登录入口（已登录将跳转对应角色首页）</li>
${externalLoginItem}    <li><code>/workbench/manager/tasks</code> — 主管 · 历史任务与改派</li>
    <li><code>/workbench/manager/chat</code> — 主管 · 智能规划助手</li>
    <li><code>/workbench/admin</code> — 管理员 · 全公司任务与权限配置</li>
    <li><code>/workbench/employee?view=new</code> — 员工 · 新任务承接</li>
    <li><code>/workbench/employee?view=current</code> — 员工 · 进行中</li>
    <li><code>/workbench/employee?view=history</code> — 员工 · 已完成</li>
    <li class="muted"><code>/workbench/manager</code>、<code>/workbench/conversation</code> 等旧书签会自动跳转到上述页面。</li>
    <li><code>/assignment/workbench</code> — 兼容入口（携带 token 时写入会话并跳转）</li>
  </ul>
  <p><strong>钉钉网页应用</strong>：可将首页 URL 配置为 <code>https://你的域名/workbench</code>（或根路径 <code>/</code>）。</p>
  <p class="muted">探活：<a href="/health">/health</a> 返回纯文本 <code>ok</code>。</p>
</body>
</html>`;
}
