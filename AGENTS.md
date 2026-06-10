# AGENTS

## 项目目标

本项目用于实现「钉钉任务规划与承接确认机器人」，核心是通过 Agent Harness 将模糊任务转为可承接、可验收、可追溯的任务闭环。

**现网主链路**：钉钉 Stream → `src/dingtalk-bot.ts` → `runOrchestrator`（ReAct + tool calling）→ 草案/指派 JSON → 工作台 SQLite 正式任务 → 通知 / 催办 / 进展推送。`createTaskPlanningDemo` 保留给 CLI / demo / eval 回归（`legacy-demo-planner-v1`，与 orchestrator 解耦）。

**多实例（2026-06）**：同一 ECS 可跑 **两个独立钉钉组织**，共用镜像 `manage-robot:dingtalk`、**隔离数据卷与 env**：

| 实例 | 容器 | 端口 | 公网域名（试点） | 数据卷 | env |
|------|------|------|------------------|--------|-----|
| 微光（组织 A） | `manage-robot-dingtalk` | `8080` | `managebot.vivolightsales.com` | `/opt/manage_robot/data` | `/etc/manage-robot.env` |
| 明思（组织 B） | `manage-robot-mingsibot` | `8081` | `mingsibot.vivolightsales.com` | `/opt/manage_robot-mingsibot/data` | `/etc/manage-robot-mingsibot.env` |

每实例须独立配置 `DINGTALK_*`、`ASSIGNMENT_WEB_PUBLIC_BASE_URL`、`WORKBENCH_NOTIFY_*`、`WORKBENCH_*_USER_IDS` 等；**`docker restart` 不会重读 `--env-file`**，改 env 后须 `docker stop && docker rm && docker run … --env-file …` 重建容器。详见 `docs/deploy-aliyun-dingtalk.md` §双容器、`scripts/ecs-setup-mingsibot.sh`、`scripts/ecs-fix-mingsibot-urls.sh`。

## 参考文档

- PRD：`docs/PRD-钉钉任务规划与承接确认机器人.md`
- 流程图：`docs/PRD-钉钉任务规划与承接确认机器人-场景流程图.md`
- Harness 设计与计划：`docs/agent-harness-架构与开发计划.md`
- Qwen 接入与运行：`docs/Qwen-接入实施说明.md`
- 阿里云部署与钉钉 Stream 机器人：`docs/deploy-aliyun-dingtalk.md`
- 任务快录入库：`docs/task-intake.md`
- 工程增强清单（审计 / 会话 / 可观测性）：`docs/harness-next-optimizations.md`
- 已知遗留问题：`docs/已知遗留问题-backlog.md`
- 历史设计稿：`docs/superpowers/`（文首标注快照，勿作现网依据）

## 当前实现边界（2026-06-09）

### 编排与 Policy 分工

- **Prompt**：模式判定（CLARIFY / QUERY / DRAFT / ASSIGN / PUBLISH / FOLLOWUP）、JSON 形态、话术与工具调用纪律。
- **Backend FSM**：publish gate、staging flag、假口播重试、同轮 prepare+publish 阻断、pre-draft gate、search/update 配额等（见 `publish-staging.ts` / `authoritative-publish.ts` / `registry-pre-draft-gate.ts` / `tools/registry.ts`）。
- **无硬编码业务状态机**：关键节点靠工具软返回 + 审计事件可观测。

### 模型与 Prompt

- **接口**：DashScope OpenAI 兼容；默认策略见 `model-policy.ts`；线上可 `QWEN_MODEL` 切换（如 `qwen3.6-flash` 降延迟，需自行验证工具调用质量）。
- **Prompt 版本**：`orchestrator-agent-v5.23.17`（`src/agent/demo/qwen-prompt.ts`）。对用户口径统一「发放/已发放」；内部工具名仍为 `prepare_publish_task` / `publish_task`。
- **项目（Portfolio，可选）**：`WORKBENCH_PROJECT_PORTFOLIO_*` 白名单内主管启用 `projects` 表 + `tasks.project_id`（可空）、**项目总览** + **历史任务（默认按项目归档、批量/行内归入）**、`list_projects` / `create_project` / `suggest_project` / `set_active_project`；**会议待办入库**（`/workbench/manager/meeting-import`，从纪要抽取/归并，仅 Portfolio 主管）；**任务快录入库**（`/workbench/manager/task-intake`，粘贴已拆清单 → 忠实映射 + AI 分组归属 → 多父任务发布/追加，**所有主管**，见 `docs/task-intake.md`）；周会投屏用 **周度 Dashboard**（非项目总览）；名单外主管（角色 B）界面与 Agent 与现网一致。
- **子任务防重复**：`appendSubtask` 支持 `clientRequestId` + 内容 dedup（`WORKBENCH_APPEND_SUBTASK_DEDUP_SECONDS`）；建议生产 `WORKBENCH_ENFORCE_ACTION_GUARDS=1`；`add_draft_subtask` 单轮配额 `ADD_DRAFT_SUBTASK_PER_ORCHESTRATOR_MAX`（默认 4）。
- **Prompt profile**（`buildQwenPlannerSystemPrompt`）：仅 **`planner`** 与 **`employee`** 两套正文；主管/admin **共用 planner 正文** + `managerFollowup` 注入第六模式 **FOLLOWUP**（见 qwen-prompt.ts 注释，勿回退独立 manager prompt）。
- **Tool profile**（`buildToolRegistry`）：`planner` / `manager` / `admin` / `employee` / `full`；与 prompt profile **解耦**——例如 `DINGTALK_ROLE_ROUTING_ENABLED=1` 时主管路由为 `promptProfile=planner` + `toolProfile=manager`。
- **操作模式**（JSON 输出意图，**不是** tool_calls 函数名）：CLARIFY 禁止与其他模式混用；QUERY 查正式任务（`list_managed_tasks` 等，admin 工具含 `list_managers` / `get_metrics`）；DRAFT / ASSIGN / PUBLISH 可同句叠加；**不设 PREPARE 模式**（`prepare_publish_task` 为工具两回合纪律）。
- **WBS / REDRAFT**：单一交付物、可验收 `completionCriteria`；用户要求拆细/扩条/WBS → 顶层完整 `draft` JSON；单点改 → `update_draft_task` / `remove_draft_subtask`。
- **Scheme C 指派**：`draft.tasks[]` **不含** assignee；负责人在 **`latestAssignment.assignments[]`**；批量点将须 **`bulk_assign_tasks` 或顶层 assignment JSON 一次 N/N**（`requireFullCoverage`）；REDRAFT 后 `reconcile-assignment` 迁移 id/截止；钉钉附表负责人列读 assignment。
- **输出纪律**：顶层 **`message` 必填**（四段导览）；**禁止**在 message 手画任务表（服务端 `renderDingtalkTaskMarkdown` 渲染）；**禁止**在用户可见 `message` 中出现工具函数名（如 `` `read_url` `` / `` `add_draft_subtask` ``）；`draft` 经 `coerceLlmPlanPayload` + `preserveOrchestratorDraftScalars` 保留 `title`/`description`/`summary`；任何姓名须先 `search_employees`；模型误调模式名作 tool → `mode_not_a_tool` 软返回。
- **外链**：用户消息含 http(s) URL → **`read_url`**（`url-fetch-guard` SSRF 防护；内网/localhost/钉钉文档读失败 → 引导复制粘贴，禁止编造）；`extractDingtalkMessageText` 统一解析 text/richText/mixed 入站。
- **花名册 fileNotes**：`set_candidate_pool` 时 `entries[*].fileNotes` 写入技能/职责摘要；ASSIGN 时 **`get_employee_details` 返回的 fileNotes 优先于空 selfProfile**（`appendPoolFileNotes`）。

### 工具（`src/agent/tools/registry.ts`）

ReAct 主链路**最终 JSON 直出 `draft`**，不依赖 `save_draft`（registry 内保留实现，**不对任何 profile 开放**）。`prepare_publish_task` 校验通过时兜底写入 `latestDraft` / `latestAssignment`。

| Profile | 数量 | 要点 |
|---------|------|------|
| `planner` | 13 | 搜人、草案 PATCH、scope 切换、knownFacts、**`read_url`** |
| `manager` | 26 | + 发布/改派/催办、`bulk_assign_tasks`、花名册 / candidate pool、**`read_url`** |
| `admin` | 30 | + `admin_list_all_tasks` / `get_metrics` / `list_managers` / `set_manager_permission`、**`read_url`** |
| `employee` | 9 | `list_my_tasks` / `submit_employee_response` / `submit_progress_update` 等 |

**硬/软配额**：`search_employees` 单次 orchestrator 最多 **3** 次；`update_draft_task` 单次 orchestrator 默认最多 **4** 次（ECS 现网 **`UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX=12`**；**第 2 次 assigneeUserId patch 引导 bulk_assign**）；`read_url` 单次 orchestrator 最多 **2** 次（`READ_URL_PER_ORCHESTRATOR_MAX`）；assignment JSON **`requireFullCoverage`** 默认 true（partial 不落库）；`publish_task` 空 draft / 缺 assignee → `ok:false` 软返回。

**Pre-draft gate**（`registry-pre-draft-gate.ts`）：无草案且非点将意图时，阻断 browse 式 `search_employees`、`search_similar_plans`、`update_known_facts`（按姓名 search 仍允许）。

**条件暴露**：`search_similar_plans` ← `SEARCH_SIMILAR_PLANS_ENABLED`；`search_web` ← `SEARCH_WEB_ENABLED` + 用户语义；`read_url` ← `READ_URL_ENABLED`（默认 `1`）+ 用户消息含 URL。

### 钉钉角色路由

`DINGTALK_ROLE_ROUTING_ENABLED=1`（默认 `0` 固定 planner）时，按 `resolveWorkbenchRole` + 员工目录匹配：

| 身份 | promptProfile | toolProfile | managerFollowup |
|------|---------------|-------------|-----------------|
| admin（`WORKBENCH_ADMIN_USER_IDS` / `_IDS_FILE`） | planner | admin | ✅ |
| admin **且** 同时在主管名单（见下） | planner | **manager** | ✅ |
| manager（主管名单） | planner | manager | ✅ |
| 员工（在 employee 目录） | employee | employee | — |
| 其他 | planner | planner | — |

**主管名单来源**（`listWorkbenchManagerIds`，并集）：`WORKBENCH_MANAGER_USER_IDS` / `WORKBENCH_MANAGER_IDS_FILE` + 动态文件 `data/workbench-managers.json`（默认路径，`WORKBENCH_DYNAMIC_MANAGER_IDS_FILE` 可覆盖）。Portfolio 主管另读 `data/workbench-portfolio-managers.json`（`WORKBENCH_PROJECT_PORTFOLIO_*` 并集）。

**Admin+主管双角色**（如姚凯珩、Rain）：`userId` 同时出现在 **admin env 白名单** 与 **主管名单**（env 或动态文件均可）。`resolveWorkbenchCapabilities` → `primaryRole=admin`、`alsoManager=true`、`canManage=true`；钉钉免登默认进 **主管视图**（`defaultLoginViewRole`）；侧栏可切 Admin / 主管 / 员工。钉钉 Agent 走 `admin_also_manager` → **`toolProfile=manager`**（日常发任务），非纯 admin 工具集；纯 admin（不在主管名单）才用 admin 工具集。Admin 白名单**仅 env 配置**；主管/Portfolio 可在 **权限中心** 或 Agent `set_manager_permission` 写动态文件。

工作台 Session 用 `resolveWorkbenchCapabilities` + `normalizeWorkbenchSession` 判定可访问页（`/workbench` JSAPI 免登）。

### 记忆

| 层级 | 机制 | 说明 |
|------|------|------|
| 会话短期 | `PlanSession.knownFacts[]` | 模型 `update_known_facts` / `list_known_facts`；按 task scope，切换 scope 不串 |
| 草案中期 | `[memory_context]` 注入 | 有未发布草案时每轮注入完整 **`latestDraft`**（`ORCHESTRATOR_DRAFT_MEMORY_MAX_CHARS` 默认 32000，超出 slim 截断）；候选池 brief 含 **`fileNotes`（截断 200 字）** |
| Plan 中期 | SQLite `memory_facts` / `memory_summaries` | 每轮异步提取（`MEMORY_EXTRACTION_MODEL` 默认 `qwen-doc-turbo`，TTL 默认 14 天）；`loadMemoryContextForPlan` 注入 top 8 facts |
| 长期 | `plan-index.ts` embedding | `search_similar_plans` 触发；受 `SEARCH_SIMILAR_PLANS_ENABLED` / `PLAN_EMBEDDING_DISABLED` 约束 |

### 钉钉会话与多任务

同一 `chatKey` 内 `PlanSession.taskScopes` 归档；每 scope 独立 **`planId`**。`start_new_task` 与 **`publish_task` 成功**（非 `alreadyPublished` / LRU 去重 / `unknown_assignees`）后自动轮转 `planId`（`DINGTALK_PLANID_ROTATE_ENABLED=0` 可关闭，默认 `1`）；旧 scope 可 `switch_back_task` 回切。

### Token 与迭代

代码默认：`DINGTALK_QWEN_MAX_TOKENS=8000`、`DINGTALK_QWEN_TIMEOUT_MS=120000`、`DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=6`、`AGENT_MAX_TOTAL_TOKENS=24000`、`DINGTALK_QWEN_THINKING=0`。**ECS 现网**（`/etc/manage-robot.env`）：`DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=30`、`AGENT_MAX_TOOL_CALLS=16`、`AGENT_MAX_TOTAL_MS=180000`、`UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX=12`、`DRAFT_FALLBACK_EXTRACT_ENABLED=1`。

### 运行时数据

- 工作台正式任务 **仅以 SQLite 为权威源**；`tasks.json` 不参与运行时。
- `tasks.description`：发布时从 `latestDraft.description`（无则 `summary`）写入。
- `subtasks` 8 个富字段列（`depends_on`、`checkpoints`、`risks`、`input_materials`、`actions`、`collaborators`、`in_scope`、`out_of_scope`）发布时从草案写入。
- 员工画像 + 钉钉通讯录：`people-directory-store`、`dingtalk_contacts`（`DINGTALK_CONTACT_SYNC_ENABLED=1`）。
- **子任务状态**：员工「接受」后直接 **`IN_PROGRESS`**（不落库 `ACCEPTED`；历史行启动时迁移）。

### 钉钉通知（`WORKBENCH_DINGTALK_NOTIFY_ENABLED=1`）

通知失败不回滚，写 `warnings` / `task_events`。

- **发布 / 改派**：工作通知卡片 + 机器人 1:1。
- **员工 accept（ASSIGNED → IN_PROGRESS）**：创建钉钉原生待办（需 unionId / 通讯录同步）；审计 `EMPLOYEE_TODO_*`。
- **员工拒绝 / 请求调整 / 阻塞 / 完成**：默认通知主管机器人 Markdown（`WORKBENCH_DINGTALK_NOTIFY_MANAGER_ENABLED`）。
- **待办静默期**：发布后员工待办列表无新项正常——待办在 accept 后才创建。

### 产品边界（仍不做 / 部分已有）

| 能力 | 状态 |
|------|------|
| 工作台 + 员工 Agent accept/reject/request_changes | ✅ v0.3 协作层 |
| 任务快录入库（忠实映射 + AI 多父任务分组/追加已有） | ✅ v1.2 |
| 钉钉卡片承接三态、OA 自动流程、电子签名 | ❌ |
| 执行中变更审批、节点反馈问卷、验收闭环 | ❌ |
| 发起人白名单 `TASK_INITIATOR_USER_IDS` 接入 dingtalk-bot | ❌（函数已有，主链路未调） |

## 工作台 UI（主管 / 员工）

- **草案 Excel 弹窗编辑**（主管 `/workbench/manager/chat`）：有 `latestDraft` 时显示「编辑草案表格」；大弹窗（92vw×88vh）单张 **10 列**宽表（核心字段 + 负责人，一行一条子任务）；`GET/POST /api/workbench/conversation/draft` + `runWorkbenchDraftRevision`（`workbenchDraftRevision` 条件 prompt、`disableTools`、max 2 轮）；`conversationHistory` 仅写 `[工作台] 已提交草案表格编辑`，不写整表 JSON；深链 `?openDraftEditor=1`；bundle `npm run build:workbench-draft-grid` → `/static/workbench-draft-grid.js`。
- **主管列表关注状态**（`workbench-attention.ts`，展示层）：`待您处理` / `待员工承接` / `员工执行中` / `阻塞中` / `已完成`；API `GET /api/workbench/manager/tasks` 含 `attentionLabel`、`attentionBucket`、`subtaskBreakdown`。
- **子任务规划字段**（双端一致）：仅展示执行要点 6 项（目标/交付/标准/截止/执行动作/前置依赖）；共享 `workbench-subtask-fields-snippet.ts`。SQLite 富字段列保留读历史，**新发布不再写入**已下线的 7 项规划字段。
- **催办按钮**：仅 `IN_PROGRESS` / `BLOCKED`（与 `reminder-send` 一致）。
- **员工**：Tab「待承接」；详情事件 `/workbench/employee/task/events`；`openSignal=changes` →「待主管回复」。
- **时间格式**：`formatWorkbenchDateTime` → `zh-CN` `yyyy-MM-dd HH:mm`。
- **周度 Dashboard**（`/workbench/manager/dashboard`）：主管按自然周查看 KPI、任务甘特、人员负载卡片、动态 feed 与按需周会建议；API `GET /api/workbench/manager/weekly-dashboard`（`week`/`span`/`feedCursor`/`feedOnly`；portfolio 用户可选 `projectId`）+ `POST /api/workbench/manager/weekly-advisor`；领域层 `src/agent/weekly-dashboard/`；历史周 `approxHistoricalState` 黄条提示；项目总览卡片可深链 `?projectId=`。
- **智能规划助手（主管 chat）**（`/workbench/manager/chat`）：
  - **线程模型**：**主线程**（canonical `workbench:main:{userId}`，钉钉与工作台共用）+ **侧会话**（`thread=side&threadId=`；新 `planId`，不动主线程草案）。
  - **Canonical 会话**：`canonical-main-session.ts` 的 `resolveCanonicalMainSession` 合并钉钉 `chatKey` 与 `workbench:main` 占位文件（`mergeMainSessions`，审计 `MAIN_SESSION_MERGE`）；钉钉入站、`POST .../send`、`GET/POST .../draft` 均经此解析；`findMainThreadSession` 为薄封装。
  - **共享编排回合**：`manager-orchestrator-turn.ts` 的 `runManagerOrchestratorTurn`（`DINGTALK_QWEN_*`、FSM 重试、`sharedPublishRecentStore`、发布后 `planId` 轮转）；钉钉 Stream 与工作台 `send` 同管线；Excel `draft/revise` 仍走 `runWorkbenchDraftRevision` 旁路。
  - **API**：`GET /api/workbench/conversation/threads`；`POST /api/workbench/conversation/new`（仅侧会话）；`GET/POST .../messages|send` 支持 `threadId`/`threadKind`（legacy `planId` 仍可读）。
  - **展示**：`conversationHistory[].displayContent` 为完整助手 Markdown（含结构化表）；`content` 仍为 orchestrator 纯模型文本。渲染链：`buildAssistantDisplayMarkdown` → `formatWorkbenchAssistantHtml`。
  - **钉钉深链**：主线程有未发布 `latestDraft` 时 outbound 追加 `ASSIGNMENT_WEB_PUBLIC_BASE_URL/workbench/manager/chat?thread=main`（`workbench-chat-link.ts`）。
  - **Resolver**：`conversation-thread-resolver.ts`（`createSideThreadSession` 等；主线程见 canonical）。
- **任务快录入库（task-intake，v1.2）**（`/workbench/manager/task-intake`）：并列于会议入库的**已拆清单**录入向导；**不挂 Portfolio 门禁**（`TASK_INTAKE_ENABLED`，默认开）。三步：粘贴 → **分组预览**（新建父任务组可多个 / 追加到已有 / 未分配）→ 提交。Preview：`structure-input`（N 进 N 出忠实映射）→ `suggest-targets`（已有 `planId` 匹配或 `newGroupId`+标题+描述/背景聚类，confidence < 0.6 未分配）→ 指派人解析；单新建组缺描述时回退 `parentDescription`。Commit：新建组全有负责人→`publishFromSession`，否则→主线程 `stageDraft`+Excel 深链；追加组→`POST .../task-intake/append`。**截止支持双模式**：主管指定 `dueAt` 或负责人自报（`dueMode=self` + `dueExpectation`）；员工承接时提交 `proposedDueAt` 立即生效，主管可在详情页强制改期（`SUBTASK_DUE_CHANGED` 审计）。本地 `npm run dev:task-intake`；测试 `tests/agent/task-intake/`、`tests/web/task-intake.test.ts`。详见 `docs/task-intake.md`。
- **Admin 工作台**：
  - **运营看板** `/workbench/admin/ops`；**权限中心** `/workbench/admin/permissions`（搜索选人为 **combobox** 单框：输入即搜、点选员工、授予/移除主管或 Portfolio 权限）。
  - `GET /api/workbench/admin/managers` 返回 `dynamicManagers` + `effectiveManagers`（env ∪ 动态文件），每项含 `userId` + 通讯录 `name`（修复前 env 内主管仅 ID 时 UI 显示「—」）。
  - `POST .../admin/managers|portfolio-managers` 写动态 JSON + `appendPermissionEvent` 审计；**不能**通过 UI 授予 admin（须改 `WORKBENCH_ADMIN_USER_IDS` 并重建容器）。
  - 实例级功能分叉示例：明思侧 `DAILY_REPORTS_PAGE_ENABLED=1`（微光默认关），见 `.env.example` 注释。

## 催办（Follow-up，v1）

- **范围**：`IN_PROGRESS` / `BLOCKED` 且 `due_at` 可解析；`ASSIGNED` 承接超时 → Phase 1.5。
- **截止语义**：纯日期 `YYYY-MM-DD` = 北京时间当天 **18:00**（`due-at-parse.ts`）。
- **Scheduler**（`FOLLOWUP_REMINDER_ENABLED=1`，工作日 `FOLLOWUP_WEEKDAYS_ONLY=1`）：
  - **T-1 预提醒（员工）**：截止前一日 10:00–10:05 窗口，机器人 1:1 + 待办。
  - **逾期主管提醒**：截止后向 `manager_user_id` 发 1 次机器人 1:1（每逾期周期 1 次）。
- **手动催办**：主管对话 / 工作台 → 仅推员工（不占 scheduler 配额）。
- **工具 / Prompt**：`list_follow_up_candidates`、`send_subtask_reminder`；主管 toolProfile 注入 **FOLLOWUP** 模式。
- **单实例**：切勿水平扩容 `dingtalk-bot`（scheduler 进程内假设）。Env 见 `docs/deploy-aliyun-dingtalk.md`。

## 每日进展推送（Progress Digest，v1.1）

- **范围**：工作日 9:00 北京窗口；`PROGRESS_DIGEST_WEEKDAYS_ONLY=1`。
- **默认模式**（`PROGRESS_DIGEST_MODE=delivery_reminder`）：近 **7 自然日**（含逾期）交付提醒单表；主管/员工/combined 分视角；**不调 LLM**（`PROGRESS_DIGEST_LLM_ENABLED=0`）。
- **legacy full 模式**（`PROGRESS_DIGEST_MODE=full`）：GFM 表格（需您处理 / 正常推进 / 昨日动态）+ 可选 `qwen3.6-flash` 概览/建议。
- **Env**：`PROGRESS_DIGEST_HORIZON_DAYS=7`；回滚 full 见 `.env.example`。
- **实现**：`src/agent/progress-digest/` + `progress_digest_state` 日去重；与催办 scheduler 并列启动。

## 主管周度 Dashboard（v1）

- **页面**：`/workbench/manager/dashboard`；主管只看自己名下正式 SQLite 任务。
- **周边界**：`WEEKLY_DASHBOARD_TIMEZONE`（默认回退 `FOLLOWUP_TIMEZONE` → `Asia/Shanghai`）下自然周一 00:00 起；默认 ±1 周，最大 `WEEKLY_DASHBOARD_SPAN_MAX=6`。
- **内容**：任务×周甘特（仅画有 `due_at` 子任务）+ 人员负载摘要 + 任务/人员明细 + 事件 feed 分页；历史周活跃态无快照时使用当前状态近似并在 UI 标注。
- **建议助手**：工作台内按需 POST，不走钉钉机器人、不定时推送；`WEEKLY_ADVISOR_LLM_*` 8s 默认超时，失败走模板 fallback。

## 员工交付绩效看板（v1）

- **页面**：`/workbench/manager/performance`（`PERFORMANCE_DASHBOARD_ENABLED=1` 默认开）；主管看本人名下、admin/老板看全员（`resolveWorkbenchCapabilities().canAccessAdmin` 判定 scope）。迟交/延期绩效画像：准时率、迟交数、平均/最大迟交天数、当前逾期、被催次数、被改派标注。
- **隔离 Agent**：页内问答框走**独立** `promptProfile=performance` + `toolProfile=performance`（仅 `get_employee_performance` / `search_employees` / `get_employee_details` / `get_current_time`，**无**草案/发放/指派/催办），不污染 planner/manager orchestrator、不接钉钉路由、不动 PlanSession 草案。入口 `runPerformanceAgentTurn`（`src/agent/performance-agent-turn.ts`）。
- **数据/口径**：`subtasks.completed_at`（DONE 时写入、迁出 DONE 清空、启动从 `SUBTASK_PROGRESS(DONE)` 事件回填）；迟交=`completed_at > effectiveDue`（纯日期截止=当天 18:00 北京）；仅统计有 `due_at` 的子任务，窗口 `PERFORMANCE_WINDOW_DAYS=90` 按截止回溯。聚合纯函数 `src/agent/performance/performance-facts.ts`，SQL 在 `loadPerformanceDataset`。
- **公正性**：`due_at` 发布后不可改；审计型 `setSubtaskDueAt` + `SUBTASK_DUE_CHANGED` 为未来「改期」预留基础设施；画像以 `reassignedInvolved` / `unknownCompletion` 标注，避免武断贴标签。
- **API**：`GET /api/workbench/manager/performance`、`POST /api/workbench/manager/performance/chat`。

## 承接指派（v0.2 MVP）

`ASSIGNMENT_PHASE_ENABLED=1` 时，orchestrator **同一次 ReAct 请求**产出 `assignment` JSON → `extractLightAssignment` → 拼入回复 Markdown。**无第二次独立 LLM**（`runAssignmentRecommendation` 仅测试/独立调用）。

- **Web 工作台**：HMAC-SHA256 签名 URL（30min TTL）；端口 `ASSIGNMENT_WEB_PORT`（默认 8787）。
- **Mock 卡片**：`DINGTALK_ASSIGNMENT_MOCK=1`。
- **花名册点将**：`read_uploaded_roster_text` → `resolve_roster_names` → `set_candidate_pool`（**须填 `fileNotes`**），避免逐条 search（见 backlog M-13）。

### 运维配置（节选）

| 变量 | 说明 |
|------|------|
| `ASSIGNMENT_PHASE_ENABLED` | `1` 开启指派段落 |
| `WORKBENCH_MANAGER_USER_IDS` / `WORKBENCH_MANAGER_IDS_FILE` | 主管身份（env 静态名单） |
| `WORKBENCH_DYNAMIC_MANAGER_IDS_FILE` | 动态主管 JSON（默认 `data/workbench-managers.json`；权限中心 / Agent 写入） |
| `WORKBENCH_ADMIN_USER_IDS` / `WORKBENCH_ADMIN_IDS_FILE` | Admin 身份（**仅 env**；改后须重建容器） |
| `WORKBENCH_PROJECT_PORTFOLIO_*` | Portfolio 主管（env + `data/workbench-portfolio-managers.json`） |
| `ASSIGNMENT_WEB_*` | 工作台 URL 签名；**每实例**独立 `ASSIGNMENT_WEB_PUBLIC_BASE_URL` |
| `WORKBENCH_NOTIFY_DETAIL_URL_BASE` | 员工通知详情链前缀（含 `/workbench/employee/task`） |
| `WORKBENCH_NOTIFY_MANAGER_DETAIL_URL_BASE` | 主管通知链前缀（实例根 URL） |
| `DINGTALK_ROBOT_CODE` | 机器人 1:1 消息；缺省可回退 `DINGTALK_CLIENT_ID` |
| `TASK_INITIATOR_*` | 发起人白名单（**主链路未接入**） |
| `TASK_INTAKE_ENABLED` | 任务快录入库页面/API/侧栏（默认开） |
| `TASK_INTAKE_LLM_*` | 结构化 + 归属建议模型/超时（见 `docs/task-intake.md`） |

**发布后文案修正**：工作台暂无「已发布任务在线改字」；运维可对 SQLite `tasks`/`subtasks` 做定向 UPDATE（示例脚本 `scripts/patch-meeting-subtask-titles.ts`），**不会**自动重发通知。

## Agent Harness 基线

- **编排**：`runOrchestrator` → `QwenCompatibleClient.callWithTools`；中间 tool 轮静默，最终 `end_turn` 的 message 对用户可见。
- **审计**：`orchestrator_done` / `orchestrator_max_turns_exceeded`；有草案时 `data/plans/<traceId>.json` 快照；demo 链路另写 `AUDIT_DEMO_JSONL_PATH`。
- **护栏**：PII 脱敏（`content-filter.ts`）、会话 TTL + 限速（`session-store.ts`）。
- **会话 TTL**：默认 30min（`CHAT_SESSION_TTL_MS`）。

### 开发顺序

1. ✅ ReAct orchestrator + profile 分工具
2. ✅ 短期 / 中期 / 长期记忆
3. ✅ 承接指派 v0.2 + Web 工作台 + SQLite 正式任务
4. ✅ 钉钉集成（免登、通知、通讯录、员工侧工具）
5. ✅ 催办 v1 + 每日进展推送 v1
6. ⏳ 承接三态（钉钉卡片）、节点反馈、验收闭环、OA 同步

## 工程约束

- 提示词、模型策略与 Schema **可版本化、可配置**；编排层禁止写死拆解文案替代模型。
- `coerce` 仅做类型/别名归一化，不得补缺失核心字段为看似可派发的默认文案。
- Demo 阶段优先「模型可写、系统可存」，减少硬门禁阻断。
- 正式 QMS/CAPA 记录不由本系统关闭；仅维护协作层状态。

## 测试与可观测

- **单元 / 集成**：`npm test`（Vitest；`vitest.setup.ts` 默认关闭审计写盘与后台 scheduler）。
- **类型检查**：`npm run typecheck`。
- **Eval 脚本（v3 矩阵）**：`npm run eval:unit`（PR）→ `npm run eval:spot`（`EVAL_TAG=` 调试）→ `npm run eval:chains`（多轮 fixture）→ **`npm run eval:release`**（发版/nightly）。Legacy 别名 `eval:deployment-parity` / `eval:natural-full` 转发至 v3。见 `docs/eval-matrix-v3.md`、`docs/agent-usage-and-eval-ops.md`。Eval 对齐现网见 `scripts/eval-production-parity-env.ts`。Admin 运营看板 `/workbench/admin/ops`、权限中心 `/workbench/admin/permissions`。**在线 Eval**：规则 L0/L1 + **LLM Judge**（`qwen-doc-turbo`，默认 ON，5% 与异常 100%）→ `eval_candidates` → `promote-eval-candidate` → `fixtures/eval-v3/promoted`；校准 `npm run eval:judge-calibrate`。**Admin+主管双角色**：admin env + 主管名单并集；钉钉 `admin_also_manager` → `toolProfile=manager`。
- **Demo 回归**：`npm run demo:eval` / `demo:scenarios`。
- **线上观测**：容器 stdout 结构化事件 + `data/plans` 快照；demo JSONL 主要用于 CLI 回归。

## 开发工作区

- 新功能使用 `.worktrees/` 独立 worktree 分支；不在 `main` 直接实现。
- `.worktrees/` 保持在 `.gitignore` 中。

## 交付定义

每个开发任务最少包含：FR 编号与验收标准、状态机/迁移说明、审计字段影响、测试更新。

## 里程碑

| 阶段 | 范围 | 状态 |
|------|------|------|
| Demo/MVP | 输入质检 → Qwen 结构化生成 → 门禁 → Markdown/表格 | ✅ |
| V1.0 | 钉钉 Stream + ReAct + 工作台 SQLite + 发布/改派/通知 | ✅ |
| V1.1 | 催办、进展推送、WBS 细拆、Scheme C、角色路由、eval 回归集 | ✅ 主体 |
| V1.2 | 双钉钉实例（mingsibot）、Admin 权限中心、动态主管名单、Portfolio 会议入库、任务快录入库（AI 多父任务分组 + 追加已有） | ✅ 试点 |
| V2 | 钉钉卡片承接三态、执行中变更、节点反馈、验收闭环 | ⏳ |
| V3 | OA/QMS 联动、电子签名、管理报表 | ⏳ |
