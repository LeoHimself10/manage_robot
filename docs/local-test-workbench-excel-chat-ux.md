# 智能助手 + Excel 草案 · 本地测试方案

适用于分支 `feat/draft-full-memory-mutate`（或已合并上述 UX 改动的版本）在 **本机浏览器** 验证，无需钉钉 Stream。

---

## 一、环境准备（一次性）

### 1. 依赖

- Node.js **≥ 22**
- 项目根目录执行过 `npm install`

### 2. 配置文件

```powershell
cd d:\manage_robot
copy .env.example .env
```

在 `.env` 中至少配置：

| 变量 | 必填 | 说明 |
|------|------|------|
| `QWEN_API_KEY` | **发送/Excel 提交必填** | DashScope API Key；不配也能测 UI，但对话与 Agent 校验会失败 |
| `ASSIGNMENT_PHASE_ENABLED=1` | 建议 | `.env.example` 默认已开 |

可选（脚本会自动写入默认值，一般不用改）：

- `ASSIGNMENT_WEB_PORT=8787`
- `WORKBENCH_TEST_LOGIN_ENABLED=1`

### 3. 启动本地服务

```powershell
npm run dev:manager-chat
```

首次启动会：

- 构建 `workbench-dd-login.js`、`workbench-draft-grid.js`
- 初始化隔离数据目录 `data/local-manager-chat-dev/`（**每次启动默认清空**，保证可重复测）
- 预置主管账号、10 名联系人、主线程草案（5 条子任务，3 条未指派）

保留上次数据（不清库）：

```powershell
npm run dev:manager-chat:keep
```

控制台会打印登录 URL 与 `QWEN_API_KEY` 是否就绪。

---

## 二、登录与入口

| 步骤 | 操作 | 预期 |
|------|------|------|
| L1 | 打开 `http://127.0.0.1:8787/workbench` | 出现工作台登录页 |
| L2 | 测试登录：`userId` = `manager-local-dev`，身份选 **主管** | 跳转到主管相关页面 |
| L3 | 打开 `http://127.0.0.1:8787/workbench/manager/chat?thread=main` | 进入 **智能规划助手** |

健康检查：`http://127.0.0.1:8787/health` → `ok`

---

## 三、智能规划助手页（Chat UX）

### 3.1 布局与草案摘要

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| C1 | 三栏布局（宽屏） | 浏览器宽度 ≥ 960px | 左：会话列表；中：对话；右：**本会话草案** 面板 |
| C2 | 压缩上下栏 | 看 pane 顶栏 + 底部输入区 | 顶栏更矮；无草案时副标题隐藏；输入框约 54px 高；消息区纵向空间更大 |
| C3 | 草案摘要条 | 进入主线程 | 有草案：「N 条子任务 · …」；无草案：「暂无草案」 |
| C4 | 右栏统计 | 看右侧草案面板 | 子任务 5、未指派 3、最近截止、前 5 条预览列表 |
| C5 | 唯一编辑按钮 | 搜索页面内「编辑草案表格」 | **仅 1 处 Primary**（PaneHead 或右栏；窄屏 mobile 条上 1 个） |
| C5b | 发送成功无绿条 | 发送成功一轮 | Composer **不**出现绿色「已同步」；仅 busy/错误有提示 |
| C5c | 草案随会话 | 主线程有草案 → 新建侧会话 | 右栏/摘要条先清空；切回主线程后恢复主线程草案，不串台 |

### 3.2 新侧会话空状态与侧会话恢复

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| C6 | 新侧会话空状态 | 点「+ 新规划会话」 | 居中紧凑欢迎（图标 + 一行说明 + 快捷键），**无**快捷 chip；不出现红色 404 |
| C6d | 侧会话重命名 | 侧会话项 hover → **⋯** → 重命名 | 列表与 pane 标题更新；主线程无 ⋯ 菜单 |
| C6e | 侧会话删除 | ⋯ → 删除 → 确认 | 列表移除；删当前会话则回 `?thread=main` 且可继续对话 |
| C6f | 删有草案侧会话 | 侧会话有未发布草案时删除 | 确认文案提示草案将丢失 |
| C6b | 侧会话发消息后刷新 | 新侧会话发一条消息后 F5 | 消息仍可加载；URL `thread=side&threadId=…` 有效 |
| C6c | 失效侧会话 | 重启 `dev:manager-chat`（清库）后打开旧侧会话 URL | 显示「找不到该会话」卡片；可点「返回主线程」 |
| C7 | 输入引导 | 看空状态底部 | 显示 `Enter` 发送 / `Shift+Enter` 换行提示 |

### 3.3 加载与发送反馈（需 QWEN_API_KEY）

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| C8 | 消息 skeleton | 切换线程或刷新 | 短暂 3 条灰色 skeleton，非纯文字「加载中」 |
| C9 | Enter 发送 | Composer 输入后按 **Enter** | 发送；**Shift+Enter** 换行 |
| C10 | 乐观 UI | 发送一条消息 | 用户气泡立即出现 |
| C11 | Pending | 发送后等待 | 助手侧虚线气泡 + 打字动画 +「已等待 N 秒」 |
| C12 | Composer 状态 | 发送中 | 发送按钮 disabled；底部蓝色 status「处理中…」 |
| C13 | 成功刷新 | 模型返回后 | pending 消失，出现助手正式回复；摘要条仍正确 |
| C14 | 失败态 | 断网或去掉 API Key 后发送 | 红色 error 气泡 + Composer 红色 status |

### 3.4 窄屏降级

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| C15 | ≤959px | 缩小窗口或 DevTools 手机模式 | 右栏隐藏；摘要条变为 pane 下方 sticky 条；侧栏 `min(40vh,280px)` 可滚动 |

---

## 四、Excel 草案弹窗

前置：主线程有草案 → 点 **编辑草案表格**。

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| E1 | 弹窗加载 | 打开编辑器 | 非「表格编辑器未加载」；16 列宽表正常显示 |
| E2 | 截止列 | 找 **截止** 列 | `date` 控件；预置行有 2026-06-xx |
| E3 | 负责人列 | 点击负责人单元格，输入「张」 | 下拉 ≥1 字即出现候选人（张三等） |
| E4 | 选负责人 | 选「张三 · 华东区」 | 单元格显示姓名；提交时能写回 userId |
| E5 | 列宽拖拽 | 拖表头列边界 | 列宽变化；刷新弹窗后仍保持（sessionStorage） |
| E6 | 行高 | 长文本 textarea | 默认更高；可纵向拉高 |
| E7 | 提交 loading | 改 1 格后点「提交修改（Agent 校验）」 | 全屏 overlay + spinner +「通常 15–30 秒」+ 已等待秒数；期间不可点表格 |
| E8 | Agent 成功 | 等待完成（需 QWEN） | 弹窗关闭；Chat 页摘要/消息刷新 |
| E9 | 深链 | 打开 `.../chat?thread=main&openDraftEditor=1` | 有草案时自动打开 Excel 弹窗 |

---

## 五、改派 · 联系人 1 字搜索

入口：`http://127.0.0.1:8787/workbench/manager/tasks` → Tab **调整分配**。

| ID | 检查项 | 操作 | 预期 |
|----|--------|------|------|
| R1 | 1 字搜索 | 新负责人输入「王」 | 出现王五、王芳、王磊等（无需 2 字） |
| R2 | 键盘 | ↑↓ + Enter | 可选中下拉项 |
| R3 | 任务详情改派 | 若有已发布任务 → 详情页改派卡片 | 同样 1 字起搜（与上同源组件） |

---

## 六、回归冒烟（自动化）

本地改代码后快速验证：

```powershell
npm run build:workbench-draft-grid
npm run lint:inline-pages
npx vitest run tests/web/workbench-contact-combo.test.ts tests/web/draft-excel-grid.test.ts tests/web/manager-conversation-side-thread.test.ts tests/infra/conversation-present.test.ts
```

全量：

```powershell
npm test
```

---

## 七、常见问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 「表格编辑器未加载」 | 未构建 draft-grid bundle | `npm run build:workbench-draft-grid` 或重启 `dev:manager-chat` |
| 发送一直 pending / 失败 | 无 `QWEN_API_KEY` 或网络 | 配置 `.env` 后重启 |
| Excel 提交超时 | Agent 校验 15–30s 正常 | 看 overlay 耗时；查终端/API 报错 |
| 登录报「不在主管白名单」 | 用了旧进程或未合并本地 ID | **务必** `npm run dev:manager-chat` 重启；登录时选 **自动判定**；勿连 8787 上旧服务 |
| 草案数据不对 | 想重置 | 重新 `npm run dev:manager-chat`（默认清库）；或 `--keep-data` 保留 |

---

## 八、静态 UI 对照稿

无需启动服务，可直接用浏览器打开对照布局：

`docs/mockups/manager-chat-excel-ux-preview.html`

（可切换空会话 / 有草案 / 发送中 / skeleton 等状态 Tab。）

---

## 九、测试记录模板

| 日期 | 测试人 | 浏览器 | QWEN | C1–C15 | E1–E9 | R1–R3 | 备注 |
|------|--------|--------|------|--------|-------|-------|------|
| | | Chrome / Edge | 有/无 | ☐ | ☐ | ☐ | |

---

**建议测试顺序**：L1–L3 → C1–C5 → E1–E6（无 API 即可）→ 配置 QWEN 后 C9–E8 → R1–R3。
