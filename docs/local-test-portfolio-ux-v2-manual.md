# Portfolio UX v2 + 操作防重复 — 手动测试方案

**版本**：2026-05-26  
**适用改动**：按项目归档默认视图、项目总览、批量归入、删除「开会展示」、子任务/按钮幂等防重复  
**前置**：`npm test` 通过（若 orchestrator 偶发超时，单独重跑 `npx vitest run tests/agent/orchestrator.test.ts`）

---

## 一、启动测试环境

```powershell
cd D:\manage_robot
# 可选：copy .env.example .env 并填 QWEN_API_KEY（本清单多数项不需 API）
npm run dev:manager-chat
```

| 项 | 值 |
|----|-----|
| 登录页 | http://127.0.0.1:8787/workbench |
| 账号 | `manager-local-dev`（身份选「自动判定」或「主管」） |
| Portfolio | 脚本已注入 `WORKBENCH_PROJECT_PORTFOLIO_USER_IDS` |
| 防重复 | 脚本已注入 `WORKBENCH_ENFORCE_ACTION_GUARDS=1` |
| 预置数据 | 2 个项目、「周度 Dashboard 演示任务」归入「Q2 渠道复盘」、「未归类演示任务」 |

**保留数据重启**（连续多天手测）：`npm run dev:manager-chat:keep`

**端口占用**：

```powershell
$env:ASSIGNMENT_WEB_PORT=8788; npm run dev:manager-chat
```

**探活**：http://127.0.0.1:8787/health → `ok`

---

## 二、测试记录模板

每条用 **P0 / P1 / P2** 标优先级；结果填 **通过 / 失败 / 跳过**；失败附截图 + 控制台 Network/Console 摘要。

| ID | 优先级 | 场景 | 步骤摘要 | 预期 | 结果 | 备注 |
|----|--------|------|----------|------|------|------|
| | | | | | | |

---

## 三、P0 — 必测（约 25 分钟）

### P0-1 登录与导航

1. 打开 `/workbench`，用 `manager-local-dev` 登录。  
2. 顶栏应出现：**项目总览**、历史任务、周度 Dashboard、智能规划助手。  
3. **不应**出现「开会展示」按钮或 `?presentation=1` 链接。

**预期**：导航正常；无 `ReferenceError`（尤其 `WB_PORTFOLIO`）。

---

### P0-2 项目总览（删除开会展示）

URL：http://127.0.0.1:8787/workbench/manager/projects

| 步骤 | 预期 |
|------|------|
| 页面加载 | 至少 2 张项目卡片（「Q2 渠道复盘」「微导管上市准备」） |
| 搜索框输入「渠道」 | 仅显示匹配项目 |
| 筛选「有待您处理」/「有阻塞」 | 列表按 KPI 过滤（可与 Dashboard 演示任务状态对应） |
| 点击「Q2 渠道复盘」卡片主体 | 跳转到 `/workbench/manager/tasks?view=group&projectId=<该项目id>` |
| 卡片上「N 条任务」文案 | 数字与该项目下任务数一致 |
| 全文搜索页面源码 `presentation` | **无** 开会展示相关 UI |

---

### P0-3 历史任务 — 默认按项目归档

URL：http://127.0.0.1:8787/workbench/manager/tasks（无 query）

| 步骤 | 预期 |
|------|------|
| 首次进入 | 视图切换默认 **「按项目归档」**（非扁平列表） |
| 分组结构 | 可见「Q2 渠道复盘」「微导管上市准备」「未归类」等分组 |
| 「Q2 渠道复盘」组内 | 含「周度 Dashboard 演示任务」 |
| 「未归类」组内 | 含「未归类演示任务」 |
| 切换「扁平列表」 | URL 含 `view=flat`，表格为传统列表 |
| 再切回「按项目归档」 | 分组恢复 |

---

### P0-4 范围 chips + 深链

| 步骤 | 预期 |
|------|------|
| 从项目总览点进「Q2 渠道复盘」 | 对应项目 chip 高亮；其它组折叠或仅显示相关范围 |
| 点击「未归类」chip | 仅未归类任务可见 |
| 点击「全部」chip | 恢复全部分组 |

---

### P0-5 批量归入项目（唯一入口）

1. 在「未归类」分组勾选「未归类演示任务」（或扁平列表勾选）。  
2. 底部 **蓝色批量条** 出现，显示已选数量。  
3. 点击 **「归入项目」**（不应依赖逐条改派侧栏）。  
4. 对话框选择「微导管上市准备」→ 确认。

**预期**：任务移入该项目分组；未归类组数量减 1；刷新后仍归属正确。

---

### P0-6 操作按钮防重复（生产 guard 已开）

**任务详情**（任选一单进入详情）：

| 操作 | 步骤 | 预期 |
|------|------|------|
| 保存子任务 | 快速连点「保存子任务」2–3 次 | 仅 1 条新子任务入库；按钮防抖/禁用 |
| 催办 | 对 `IN_PROGRESS` 子任务连点「催办」 | 仅 1 次有效请求；第二次提示或静默（幂等） |
| 列表改派 | 历史任务列表改派后连点「保存改派」 | 不重复提交 |

**可选（DevTools → Network）**：重复请求带相同 `idempotencyKey` / `clientRequestId` 时，服务端返回已有结果而非重复写入。

---

### P0-7 角色 B 回归（可选，需第二个浏览器/无痕窗口）

若需验证未开 portfolio 的主管：

1. 临时从 `.env` **去掉** `WORKBENCH_PROJECT_PORTFOLIO_USER_IDS` 中的测试账号，或新建非白名单 userId 登录。  
2. 访问 `/workbench/manager/tasks`。

**预期**：无「项目总览」导航；历史任务为 **扁平列表**（无按项目归档工具条）；页面无 JS 报错。

> 默认 `dev:manager-chat` 已开 portfolio，本项可标 **跳过** 若只验角色 A。

---

## 四、P1 — 建议测（约 20 分钟）

### P1-1 批量选择与改派互斥

1. 勾选 2 条任务 → 批量条出现。  
2. 观察单行「改派」按钮。

**预期**：有勾选时行内改派变淡/不可点（`wb-has-selection`）；取消勾选后恢复。

---

### P1-2 项目总览新建项目

1. `/workbench/manager/projects` → **新建项目**。  
2. 名称「手测临时项目」→ 保存 → 刷新。

**预期**：新卡片出现；进入历史任务可在分组中看到空项目或 0 条任务提示。

---

### P1-3 智能规划助手文案

URL：http://127.0.0.1:8787/workbench/manager/chat?thread=main

**预期**：侧栏/上下文出现 **「当前项目」** 相关文案（非「大项目」）；无「开会展示」入口。

---

### P1-4 周度 Dashboard

URL：http://127.0.0.1:8787/workbench/manager/dashboard

**预期**：页面正常；顶栏有「项目总览」；周会说明指向 Dashboard 而非开会展示。

---

### P1-5 扁平列表筛选（portfolio 开启时）

URL：`/workbench/manager/tasks?view=flat`

**预期**：传统筛选仍可用；与归档视图数据一致。

---

## 五、P2 — 有余力再测

| ID | 场景 | 说明 |
|----|------|------|
| P2-1 | Excel 草案编辑 | 见 [local-test-workbench-excel-chat-ux.md](./local-test-workbench-excel-chat-ux.md) |
| P2-2 | 发布链 | 需 `QWEN_API_KEY`：prepare → publish |
| P2-3 | `eval:portfolio-suite` | `npm run eval:portfolio-suite`（需 API Key） |
| P2-4 | 任务详情顶栏「所属项目」下拉 | **未实现**（计划 B4），跳过 |

---

## 六、发版前自动化（可选）

```powershell
npm test
npx vitest run tests/web/manager-projects-portfolio.test.ts tests/web/assignment-workbench.test.ts
# 有 QWEN_API_KEY 时：
npm run eval:portfolio-suite
```

---

## 七、常见问题

| 现象 | 处理 |
|------|------|
| 8787 占用 / SQLite EBUSY | 结束旧 `node` 进程后重启；或用 `dev:manager-chat:keep` |
| 无「项目总览」 | 确认用 `npm run dev:manager-chat` 启动（非 `dev:external-workbench`） |
| 列表空白 | 默认每次启动清空 `data/local-manager-chat-dev/`；用 `:keep` 保留 |
| `WB_PORTFOLIO is not defined` | 拉最新代码并重启 |
| 连点仍重复子任务 | 确认响应头/请求体含 `clientRequestId`；查 `append_subtask_idempotency` 表 |

---

## 八、相关文档

- [local-test-environment.md](./local-test-environment.md) — 环境与 eval 分层  
- [local-test-workbench-excel-chat-ux.md](./local-test-workbench-excel-chat-ux.md) — 聊天 / Excel  
- [AGENTS.md](../AGENTS.md) — Portfolio 与 guard 说明
