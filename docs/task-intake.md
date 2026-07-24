# 任务快录入库（task-intake）

> 现网口径文档（2026-06-09）。历史设计快照见 `docs/superpowers/specs/2026-06-05-task-intake-design.md`。

## 定位

与 orchestrator **对话拆解**、**会议待办入库**（meeting-import）并列的第三条录入路径：用户粘贴**已拆好**的任务清单，系统做忠实字段映射与智能归属建议，主管在分组预览页微调后一次性发布或追加。

| 对比项 | task-intake | meeting-import | orchestrator chat |
|--------|-------------|----------------|-------------------|
| 入口 | `/workbench/manager/task-intake` | `/workbench/manager/meeting-import` | 钉钉 / 主管 chat |
| 主管范围 | **所有主管** | Portfolio 白名单 | 所有主管 |
| 项目归档 | 可选（Portfolio 有下拉） | 必选项目 | 可选 |
| LLM 角色 | 忠实映射 + 归属分组 | 从纪要抽取/归并 | 对话规划/点将 |
| 追加已有父任务 | ✅ `append` API | ✅ | ✅ 工具链 |

## 向导流程

```
步骤 1  粘贴正文（已拆任务清单 / AI 听记正文）+ 可选主题提示
        POST /api/workbench/manager/task-intake/preview
        或在“最近会议”Tab 选择本人相关 AI 听记 / 云录制会议
        GET  /api/workbench/manager/task-intake/meetings?days=14
        POST /api/workbench/manager/task-intake/meetings/preview
步骤 2  分组预览（新建父任务组 / 追加到已有 / 未分配）
        可改标题、描述/背景、项目、子任务字段、负责人
步骤 3  按组提交
        POST .../task-intake/commit   （新建父任务）
        POST .../task-intake/append   （追加到已有父任务，每组独立调用）
```

### Preview 管线

1. **`structure-input.ts`** — 单次约束式 LLM（失败则行切分 fallback）：`parentTitle`、`parentDescription`、子任务列表；**N 进 N 出**，禁止增删合并或润色标题。
2. **`suggest-targets.ts`** — 第二次 LLM（失败非致命，UI 退化为单组）：对每条子任务建议
   - **A** 归属已有父任务（`targetPlanId`，confidence ≥ 0.6）
   - **B** 归入新建父任务组（`newGroupId` + `newGroupTitle` + `newGroupDescription`）
   - **C** 未分配（confidence < 0.6，用户手动拖组）
3. **`resolve-assignees.ts`** — 姓名 → `userId`（复用 meeting-import `resolveAssigneeByName`）。
4. **描述兜底** — 仅一个新建组且模型未给 `newGroupDescription` 时，服务端与 UI 均回退 `structure-input` 的 `parentDescription`。

### 最近会议（实例级可选）

- 开关：`TASK_INTAKE_DINGTALK_MEETINGS_ENABLED=1` 后，步骤 1 会出现“粘贴录入 / 最近会议”两个 Tab；默认关闭，每个钉钉组织实例在权限与事件订阅就绪后可独立开启。
- 统一模型：系统只有一种“会议”。`conferenceId`、`taskUuid`、日历事件 ID、会议室码只是同一会议的不同来源标识，不再把正式会议和临时会议存成两类业务对象。拿到多个标识时优先按明确标识归并；缺少直接关系时，仅在创建人一致、标题高相似且开始时间相差不超过 5 分钟、并且候选唯一时自动合并。
- 事件：`dingtalk-bot` Stream 同时接收会议、录制、ASR 与 `minutes_task_status_change` 事件。`taskUuid` 事件在返回 ACK 前同步落库；SQLite 暂时失败时返回 `LATER` 请求钉钉重投，避免会议静默丢失。
- 统一读取：主管点击导入时依次使用：① 已缓存的完整转写；② 当前主管 OAuth 可读的 `taskUuid` AI 听记（按 `nextToken` 拉完）；③ 企业应用免个人授权可读的 `conferenceId` 云录制转写。某一路权限不足或不可用时自动回退下一路，不要求用户判断会议类型。
- 发现与过滤：日历、Stream 事件和 DWS `list all`（本人创建 + 被共享）共同发现会议。列表只展示已经有转写，或已经确认存在 `taskUuid` AI 听记的会议；只有日历记录、没有任何 AI 听记/云转写的会议不展示、不处理。
- 授权：主管个人 OAuth 只用于扩大其可读取的 AI 听记范围，不改变会议类型。每位主管使用独立 DWS HOME；即使未完成个人授权，只要实时 ASR 缓存或企业应用云录制接口可读，仍可免个人授权导入。
- 范围：API 按当前登录主管的 `unionId` 过滤，只展示/导入创建人、主持人或成员列表包含本人的会议；Admin 组织全量视图本期不做。
- 前提：企业应用云录制读取需授权 `VideoConference.Conference.Read`；听记发现需订阅 `minutes_task_status_change`；需要读取本人/共享历史听记的主管配置独立 DWS OAuth profile。工作台还需要能从 `dingtalk_contacts` 解析当前用户 `unionId`（通常开启 `DINGTALK_CONTACT_SYNC_ENABLED=1`）。

### 步骤 2 分组视图

- **新建父任务**：支持**多个** AI 建议组（`ng_1`、`ng_2`…），每组独立父标题 / 描述 / 可选项目；可手动「新建分组」。
- **追加到已有**：子任务挂到 SQLite 已有父任务；提交走 `append`（子任务须填齐目标/交付/标准/截止/负责人，**无暂存草案路径**）。
- **未分配**：confidence 不足或未建议的行，用户可拖入任一组。

### 截止日期模式（2026-06）

- 每条子任务支持两种模式：
  - **指定截止**：主管填写 `dueAt`（YYYY-MM-DD，必填）
  - **负责人自报**：发布时不写 `dueAt`，可填写 `dueExpectation`（如“三天左右”）
- 自报模式下，员工承接时需提交 `proposedDueAt`，系统写入 `subtasks.due_at` 且 `due_set_by='employee'`
- 主管可通过任务详情「改截止」强制改期，写 `SUBTASK_DUE_CHANGED` 审计事件，`due_set_by='manager'`

UI 注意：负责人 combobox 在卡片内展开时使用 `focus-within` 抬升 z-index，避免遮挡相邻字段。

## Commit 分支（新建父任务）

`commit-task-intake.ts` 对每个新建组：

- 选中行**全部有负责人** → `publishFromSession` 正式任务（`confirmationContext: task-intake-wizard`）。
- **缺负责人** → `stageDraft` 写入主管**主线程** session，返回深链 `/workbench/manager/chat?thread=main&openDraftEditor=1`（审计 `TASK_INTAKE_STAGED`）。
- 自报模式字段会写入 `latestDraft.tasks[*].dueMode/dueExpectation`，后续经 Excel 草案编辑发布链路保留。

## 模块索引

| 路径 | 职责 |
|------|------|
| `src/agent/task-intake/structure-input.ts` | 忠实结构化 |
| `src/agent/task-intake/suggest-targets.ts` | AI 归属 / 多父任务分组 |
| `src/agent/task-intake/resolve-assignees.ts` | 预览行 + 指派人解析 |
| `src/agent/task-intake/commit-task-intake.ts` | 发布 / 暂存 / 追加 |
| `src/agent/task-intake/task-intake-llm.ts` | LLM 策略与测试 hook |
| `src/agent/task-intake/task-intake-flag.ts` | `TASK_INTAKE_ENABLED` |
| `src/agent/task-intake/dingtalk-meetings-flag.ts` | 最近会议 Tab 开关 |
| `src/integrations/dingtalk/meeting-recording.ts` | 钉钉云录制转写正文 client |
| `src/integrations/dingtalk/meeting-events.ts` | Stream 闪记 / ASR 事件缓存 |
| `src/infra/dingtalk-meeting-store.ts` | 会议、成员与转写片段 SQLite 缓存 |
| `src/web/task-intake-api.ts` | preview / commit / append HTTP 处理器 |
| `src/web/manager-task-intake-page.ts` | 向导 UI |
| `scripts/local-task-intake-dev.ts` | 本地免钉钉开发 |

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `TASK_INTAKE_ENABLED` | `1`（未设即开） | `0` 隐藏页面、API、侧栏 |
| `TASK_INTAKE_LLM_ENABLED` | `1` | 关则 structure 走行切分 fallback；suggest 跳过 |
| `TASK_INTAKE_LLM_MODEL` | `qwen3.6-flash` | structure + suggest 共用 |
| `TASK_INTAKE_LLM_TIMEOUT_MS` | `30000` | |
| `TASK_INTAKE_LLM_MAX_TOKENS` | `4000` | |
| `TASK_INTAKE_DINGTALK_MEETINGS_ENABLED` | `0` | `1` 开启“最近会议”Tab、会议缓存事件处理与会议 preview API |
| `DINGTALK_MINUTES_DWS_ENABLED` | `0` | `1` 开启 AI 听记历史补查与 taskUuid 转写读取 |
| `DINGTALK_MINUTES_DWS_PATH` | — | 官方 `dws` 可执行文件绝对路径 |
| `DINGTALK_MINUTES_DWS_PROFILES_FILE` | — | JSON：主管 userId 到其隔离 OAuth HOME 的映射 |
| `DINGTALK_MINUTES_DWS_HOME` | — | 单主管试点的 OAuth HOME；须配合 userId 白名单 |
| `DINGTALK_MINUTES_DWS_MANAGER_USER_IDS` | — | 允许使用单一 OAuth HOME 的主管 userId，逗号分隔 |
| `DINGTALK_MINUTES_DWS_TIMEOUT_MS` | `30000` | 单次 DWS 调用超时 |
| `DINGTALK_MINUTES_DWS_MAX_PAGES` | `20` | 列表或完整转写最大翻页数 |

## 本地开发

```powershell
npm run dev:task-intake
# 浏览器 http://127.0.0.1:8787 ，登录页选主管 userId
# 示例粘贴文本见 scripts/local-task-intake-dev.ts（SAMPLE_PASTE_*）
```

持久化数据：`data/local-task-intake-dev/`（`dev:task-intake:keep` 保留）。

## 测试

```bash
npx vitest run tests/agent/task-intake/ tests/web/task-intake.test.ts tests/integrations/dingtalk/meeting-recording.test.ts tests/integrations/dingtalk/meeting-events.test.ts tests/infra/dingtalk-meeting-store.test.ts
```

覆盖：忠实结构化、指派人解析、commit 发布/暂存、HTTP 门禁（员工 403、`TASK_INTAKE_ENABLED=0` 重定向）。

## 与会议入库的关系

- meeting-import **不修改**；task-intake 独立 API 与 commit 实现。
- 后续可抽 `publish-grouped-rows` 共享发布循环（见 backlog / 设计快照「后续」节）。
