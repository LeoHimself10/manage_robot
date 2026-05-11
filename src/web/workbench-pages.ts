import type {
  WorkbenchInProgressSession,
  WorkbenchTaskSummary,
} from "./workbench-types";

export interface WorkbenchTaskPageInput {
  userName: string;
  tasks: WorkbenchTaskSummary[];
}

export interface WorkbenchInProgressPageInput {
  userName: string;
  sessions: WorkbenchInProgressSession[];
}

export function renderManagerPage(input: WorkbenchTaskPageInput): string {
  return page("主管工作台", `
<header>
  <p>当前用户：${escapeHtml(input.userName)}</p>
  <h1>分配与追踪中心</h1>
</header>
<nav>
  <a href="/workbench/conversation">任务对话中心</a>
  <a href="/workbench/in-progress">进行中任务</a>
</nav>
<section aria-labelledby="manager-filters">
  <h2 id="manager-filters">筛选</h2>
  <label>关键词 <input name="keyword" type="search"></label>
  <label>状态 <select name="stage"><option>全部任务</option></select></label>
</section>
<section aria-labelledby="manager-tasks">
  <h2 id="manager-tasks">任务列表</h2>
  ${renderTaskList(input.tasks)}
</section>`);
}

export function renderEmployeePage(input: WorkbenchTaskPageInput): string {
  return page("员工工作台", `
<header>
  <p>当前用户：${escapeHtml(input.userName)}</p>
  <h1>我的任务</h1>
</header>
<nav>
  <a href="/workbench/conversation">任务对话中心</a>
  <a href="/workbench/in-progress">进行中任务</a>
</nav>
<section aria-labelledby="employee-tasks">
  <h2 id="employee-tasks">待处理子任务</h2>
  ${renderTaskList(input.tasks)}
</section>`);
}

export function renderConversationCenterPage(): string {
  return page("任务对话中心", `
<header>
  <h1>任务对话中心</h1>
  <p>在这里发起新规划，或绑定既有任务继续编辑。</p>
</header>
<main>
  <section aria-labelledby="new-task-mode">
    <h2 id="new-task-mode">开启新任务</h2>
    <button type="button">开启新任务</button>
  </section>
  <section aria-labelledby="edit-task-mode">
    <h2 id="edit-task-mode">编辑进行中任务</h2>
    <button type="button">编辑进行中任务</button>
  </section>
</main>`);
}

export function renderInProgressPage(input: WorkbenchInProgressPageInput): string {
  return page("进行中任务", `
<header>
  <p>当前用户：${escapeHtml(input.userName)}</p>
  <h1>进行中任务</h1>
</header>
<section aria-labelledby="session-queue">
  <h2 id="session-queue">会话队列</h2>
  ${renderSessionList(input.sessions)}
</section>`);
}

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>`;
}

function renderTaskList(tasks: WorkbenchTaskSummary[]): string {
  if (tasks.length === 0) return "<p>暂无任务</p>";
  return `<ul>${tasks.map(renderTaskItem).join("")}</ul>`;
}

function renderTaskItem(task: WorkbenchTaskSummary): string {
  return `<li>
  <strong>${escapeHtml(task.title)}</strong>
  <span>${escapeHtml(task.stage)}</span>
  <code>${escapeHtml(task.planId)}</code>
</li>`;
}

function renderSessionList(sessions: WorkbenchInProgressSession[]): string {
  if (sessions.length === 0) return "<p>暂无进行中会话</p>";
  return `<ul>${sessions.map(renderSessionItem).join("")}</ul>`;
}

function renderSessionItem(session: WorkbenchInProgressSession): string {
  return `<li>
  <strong>${escapeHtml(session.title)}</strong>
  <span>${escapeHtml(session.stage)}</span>
  <code>${escapeHtml(session.conversationId)}</code>
</li>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
