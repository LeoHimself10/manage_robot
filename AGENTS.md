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
- 质量追踪快速接手包：`docs/quality-tracking-baseline/README.md`
- 工程增强清单（审计 / 会话 / 可观测性）：`docs/harness-next-optimizations.md`
- 已知遗留问题：`docs/已知遗留问题-backlog.md`
- 历史设计稿：`docs/superpowers/`（文首标注快照，勿作现网依据）

### 质量追踪文档读取规则

- 处理质量追踪需求、页面或服务前，先读 `docs/quality-tracking-baseline/README.md`，再按其中任务路由读取对应基线；不要默认扫描整个仓库。
- `AGENTS.md` 中“质量追踪统一系统目标基线（2026-08-19）”记录已确认的新需求；`docs/quality-tracking-baseline/` 仍用于核对当前源码与既有交互。目标基线不是已上线声明，实现状态必须以源码和测试为准。
- HTML 综合原型是评审材料，不是运行时事实；硬编码数量、相似度和置信度不得描述为生产数据。
- 来源快照只读；人工研判另存；保存事件草稿不等于正式通报，只有提交成功才把来源标记为 `REPORTED`。
- 文档与源码冲突时，以当前源码行为为准，并同步更新基线文档、关键测试和 `last_verified_at`。
- 修改页面前读 `03-html-interaction-spec.md`；修改 API、SQLite 或权限前读 `04-api-data-source-map.md`；做方案判断前检查 `05-decisions-and-gaps.md`。

## 当前实现边界（2026-07-13）

### 编排与 Policy 分工

- **Prompt**：模式判定（CLARIFY / QUERY / DRAFT / ASSIGN / PUBLISH / FOLLOWUP）、JSON 形态、话术与工具调用纪律。
- **Backend FSM**：publish gate、staging flag、假口播重试、同轮 prepare+publish 阻断、pre-draft gate、search/update 配额等（见 `publish-staging.ts` / `authoritative-publish.ts` / `registry-pre-draft-gate.ts` / `tools/registry.ts`）。
- **无硬编码业务状态机**：关键节点靠工具软返回 + 审计事件可观测。

### V2 LangGraph 编排器（`ORCHESTRATOR_ENGINE=v2`）

现网通过环境变量 **`ORCHESTRATOR_ENGINE=v2`** 启用 LangGraph 薄 harness，替代 legacy ReAct 循环（默认 `legacy` 保持向后兼容）。

**架构要点**（`src/agent/v2/`）：

- **图节点**：`tools_node`（执行工具）→ `llm_node`（模型推理）→ `end_turn`，无业务状态机。
- **Turn Contract**（`turn-contract.ts`）：每轮起始做草案快照（`snapshotDraft`），工具层面保证状态单调递增；`RETRY_KIND_GATES` 定义各重试类型的 `frontier`（工具白名单）与 `toolChoice`（`required` / `auto`）。
- **事务化补跑**（`manager-turn-v2.ts`）：`pickV2Retry` 识别失败模式（`assign`/`draft_fallback`/`url_fetch`）→ 显式门控补跑 → 验证后提交；失败则回滚到快照，防止状态退化。
- **Frontier 机制**：重试时把工具暴露范围缩为最小集（如 `assign` 补跑只开放 `["bulk_assign_tasks","search_employees"]`），首次迭代 `tool_choice=required` 强制调用，后续迭代降为 `auto` 但仍限 frontier，防止模型跑偏调无关工具（如在 assign 补跑中重复 `create_project`）。
- **V2 专属工具**：`split_draft_task`（原子行拆分，返回 `allTaskIds` 避免 partial_assignment）、`assign_from_roster`（花名册批量点将）、`intent_classifier`（工具调用门控）。
- **消息提取**：`extractTextContent` 自动识别模型误输出 legacy JSON 格式并提取 `message` 字段，向后兼容。
- **历史压缩**：`V2_HISTORY_COMPACT_CHARS=24000`、`V2_HISTORY_COMPACT_KEEP_TURNS=6`，超限时自动压缩历史上下文。

| 变量 | 默认 | 说明 |
|------|------|------|
| `ORCHESTRATOR_ENGINE` | `legacy` | `v2` 启用 LangGraph 编排器 |
| `V2_HISTORY_COMPACT_CHARS` | `24000` | v2 历史压缩触发字符阈值 |
| `V2_HISTORY_COMPACT_KEEP_TURNS` | `6` | v2 压缩后保留最近轮数 |

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

**`bulk_assign_tasks` 便捷参数**：`fillDefaultAssigneeUserId` — 将草案中**所有未在 `assignments[]` 中显式列出**的 taskId 全部指派给该 userId；全员单人时只传 `fillDefaultAssigneeUserId` + 空 `assignments: []` 即可，无需逐条枚举，规避 `split_draft_task` 后模型遗漏新 taskId 导致 `partial_assignment`。失败时 `allDraftTaskIds` 字段返回当前草案全量 ID，便于模型重试修正。

**`split_draft_task`**（v2 专属原子工具）：将草案单行原子拆成 2 条以上（`update` + `add_draft_subtask` 连续原子写）。返回 `allTaskIds`（拆后草案全量 taskId）+ `hint` 明确列出，避免模型随后调 `bulk_assign_tasks` 时遗漏新插入行。

**Pre-draft gate**（`registry-pre-draft-gate.ts`）：无草案且非点将意图时，阻断 browse 式 `search_employees`、`search_similar_plans`、`update_known_facts`（按姓名 search 仍允许）。

**条件暴露**：`search_similar_plans` ← `SEARCH_SIMILAR_PLANS_ENABLED`；`search_web` ← `SEARCH_WEB_ENABLED` + 用户语义；`read_url` ← `READ_URL_ENABLED`（默认 `1`）+ 用户消息含 URL。

**DRAFT_FALLBACK_EXTRACT_ENABLED**（默认 `1`）：orchestrator 检测到模型输出了 DRAFT 风格描述文字但未输出 JSON（`looksLikeDraftStyleMessage`）时，自动触发一次补全调用提取 `draft` 字段，防止"有口播无表格"。

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

代码默认：`DINGTALK_QWEN_MAX_TOKENS=8000`、`DINGTALK_QWEN_TIMEOUT_MS=120000`、`DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=6`、`AGENT_MAX_TOTAL_TOKENS=24000`、`DINGTALK_QWEN_THINKING=0`。**ECS 现网**（`/etc/manage-robot.env`）：`ORCHESTRATOR_ENGINE=v2`、`DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=30`、`AGENT_MAX_TOOL_CALLS=16`、`AGENT_MAX_TOTAL_MS=180000`、`UPDATE_DRAFT_TASK_PER_ORCHESTRATOR_MAX=12`、`DRAFT_FALLBACK_EXTRACT_ENABLED=1`。

### 运行时数据

- 工作台正式任务 **仅以 SQLite 为权威源**；`tasks.json` 不参与运行时。
- `tasks.description`：发布时从 `latestDraft.description`（无则 `summary`）写入。
- `subtasks` 8 个富字段列（`depends_on`、`checkpoints`、`risks`、`input_materials`、`actions`、`collaborators`、`in_scope`、`out_of_scope`）发布时从草案写入。
- 员工画像 + 钉钉通讯录：`people-directory-store`、`dingtalk_contacts`（`DINGTALK_CONTACT_SYNC_ENABLED=1`）。
- **子任务状态**：员工「接受」后直接 **`IN_PROGRESS`**（不落库 `ACCEPTED`；历史行启动时迁移）。

### 质量追踪（当前 legacy 实现，迁移前事实）

- 页面：`/workbench/quality`；售后主管和质量专员始终保留入口，普通用户及外部密码会话在服务端拒绝。
- 角色：`QUALITY_AFTERSALES_MANAGER_USER_IDS`、`QUALITY_SPECIALIST_USER_IDS`、`QUALITY_SPECIALIST_REPORTS_FILE`；质量意见页为 `/workbench/quality/opinions`。
- 来源：仅用企业内部应用的钉钉表格 GET 接口读取“客户端问题反馈记录表”；需 `DINGTALK_CLIENT_ID`、`DINGTALK_CLIENT_SECRET`、`QUALITY_SOURCE_WORKBOOK_ID`、`QUALITY_SOURCE_OPERATOR_UNION_ID` 四项完整。
- 同步：进程启动立即读取一次，之后每 2 小时读取；失败时保留最近成功缓存。`QUALITY_SOURCE_SYNC_ENABLED=0` 可显式禁用。
- 存储：质量事件、快照、链路、证据、验收、私密评论、审计和通知均使用独立 `quality_*` SQLite 表；附件使用 `QUALITY_FILE_DIR` / `QUALITY_EVIDENCE_DIR`。质量节点仅通过确定性桥接复用正式任务能力，普通任务数据与行为不变。
- 任务桥接：质量专员指定原主责后，每个分配节点以 `quality-node:{nodeId}` 确定性键桥接到原正式任务/子任务；主管和员工在原任务页承接、驳回、查看背景和继续分配，不改动普通任务 JSON 与流程。
- 证据与验收：叶子节点必须上传至少一份证据才能提交；证据退回不删历史版本；直接上级逐级验收，原主责看全链路证据包并整体通过后送质量专员。
- 终验：质量专员可指定节点退回、填写结论关闭、说明原因并选节点重开；关闭事件只读，历史证据和审计不删除。
- 私密评论：`/workbench/quality/opinions` 仅允许配置下级与对应质量专员双方查看；第三人及 admin 无旁路权限；正文不进入公开审计、任务事件、证据包或通知摘要。
- 通知：业务事务只写 `quality_notification_outbox`，后台每 30 秒异步发送；1/5/15/60/360 分钟阶梯退避，最多 8 次后由质量专员在事件详情人工重新入队。质量节点复用现有正式子任务 T-1 与直接上级逾期提醒，附加扫描只补原主责和质量专员，避免重复通知承接人。
- 权限：质量专员看全部已通报事件公开全链；售后主管只看自己通报事件；原主责看整树；协同主管看自己的分支；执行人只看自己的节点。查询与下载均在服务端校验。
- 测试：`tests/security/quality-capabilities.test.ts`、`tests/quality/`、`tests/web/quality-*.test.ts`；Vitest 默认禁止真实网络同步。

### 质量事件多视角与测试隔离（2026-08-27，功能开关默认关闭）

- `QUALITY_EVENT_ROLE_PANELS_ENABLED=1`：`/workbench/quality` 改用服务端 presentation/projector 字段白名单；admin 可只读预览马荣鑫/佟成/主管/看板，非 admin 忽略客户端视角参数。
- `QUALITY_TEST_ACTORS_ENABLED=1`：仅 admin 可使用四个质量流程测试身份和三个测试员工（研发中心 2 人、质量部 1 人）；测试身份不写入通讯录、通用主管名单或正式任务。测试事件以 `quality_events.is_test=1` 隔离，旧行迁移默认 `0`。
- 主管选择器固定七个部门，读取通讯录明确主管标记或 `QUALITY_SUPERVISOR_ROUTING_FILE` 质量专用补充名单；禁止按职位关键词推断，朱锐稳定 `userId=014517256544` 默认排除；提交只接受单个 `candidateRef` 并实时复验。
- 测试质量通知强制 `TEST` 通道；outbox 入队前和 scheduler 发送前双重校验，绝不调用真实钉钉 notifier。测试质量节点不建立 `quality_task_links`，桥接补偿也排除测试事件。
- 受控种子：`npm run quality:seed-test-data`（还需显式启用测试身份），幂等准备 12 条分阶段测试事件，覆盖初析、主管选择/承接、同部门员工分配、员工证据、逐级验收、终验关闭和重开；不创建正式任务或真实通知。
- 页面继续沿用原“质量追踪 / 质量异常工作台”布局与视觉，仅在原头部增加紧凑视角切换；测试身份下的承接、分配、证据和验收按钮只调用测试专用动作接口。

### 质量追踪统一系统目标基线（2026-08-19，已确认需求）

本节是后续质量追踪产品与 HTML 设计的目标约束；与上方 legacy 角色、意见页或重复分配入口冲突时，以本节作为改造方向。未完成迁移前，不能把目标行为描述成当前生产行为。

#### 产品边界与角色收敛

- 原任务分配系统已在使用，页面、正式任务表、状态机、承接/执行/验收逻辑和现有 API 默认不得改造；质量功能以新增模块接入。
- 只保留 `admin`、`manager`、`employee` 三个基础角色；售后主管/项目主管统一为 `manager`，普通员工与质量专员统一为 `employee`。
- “质量专员”不是第四角色，而是 `employee + quality_management` 能力；删除“质量意见人员”及其产品入口，不在新设计中延续 `/workbench/quality/opinions`。
- 能力决定是否可操作，角色/数据范围决定可见范围；“可见”不等于“可处理”。

#### 权限基线

- `admin`：全局可见反馈、事件、任务关联、证据、AI 建议、人工修正和审计；默认只读业务流程，只管理账号、能力、分类字典、规则/案例库版本和审核样本。紧急代处理须另授能力、强制填写原因并单独审计。
- `manager`：审核并修正 AI 研判，决定普通反馈/待补资料/质量异常；在原任务系统正式分配、改派、改期和逐级验收；仅看自己通报、自己负责或本部门范围。
- 普通 `employee`：只处理分配给自己的正式任务，填写进度、上传证据、提交完成或按退回意见补充。
- `employee + quality_management`：看全部质量事件，填写/修订质量初析，聚合责任链和证据，指定节点质量退回，终验、关闭与重开；不得在质量页直接选人、改派或代替主管验收正式任务。
- 若 admin 也要处理质量业务，必须显式附加 `quality_management`；处理权限不得由 admin 身份隐式获得。

#### 业务流程

- 来源反馈只读快照 → AI 原始研判 → 主管人工审核。
- 主管结论为 `ORDINARY`：记录人工结论、回写来源、生成审核样本并结束；`NEEDS_INFO`：记录信息缺口，来源版本更新后重新研判且保留旧版本；`REPORT`：正式创建质量事件。
- 质量事件创建后，由具备 `quality_management` 的员工填写/调整质量初析，再点击“完成初析，进入任务分配”。
- 正式负责人、执行人和期限只通过原任务分配系统确认；员工在原任务系统执行，主管在原任务系统逐级验收，质量人员最后聚合证据并终验关闭或退回指定节点。
- 关闭后沉淀最终分类、根因、措施、验证结果和 AI 审核样本；重开必须选择节点、填写原因且不删除历史。

#### AI 研判与可控进化

- AI 输出是“原始研判建议”，不是正式结论；必须与主管最终研判分层显示和分表/分记录保存，人工内容不得覆盖 AI 快照。
- AI 快照至少保存：建议 ID、来源版本、规则版本、案例库版本、模型/提示词版本、建议处理方式、分类、风险、判断依据、相似案例、信息缺口和生成时间。
- 未经过真实校准时禁止把硬编码的 `86%` 等数字描述为准确率；UI 使用“证据较强/一般/不足”。
- 主管操作为“直接采纳 / 修改后采纳 / 否决并重新判断”；处理方式、分类、风险或结论任一变化时自动识别差异并强制填写修正原因。
- 学习样本同时包含 AI 原建议、主管最终结论、差异、原因、审核人/时间，以及质量事件最终根因和验证结果。
- 自进化采用受控闭环：样本进入待评估池 → 质量治理人员复核 → 有效样本进入案例库/训练集 → 离线回归评估 → 版本发布与回滚。单次人工修改不得即时改变线上模型。
- 质量研判模型与人员分配模型分开评估；不得把负责人调整直接当成质量分类纠错样本。

#### 质量初析与版本

- 初析字段：问题方向、人工确认分类、来源事实摘要、分析依据、初步结论、信息缺口、建议责任部门、处理要求、建议总期限。
- 质量初析只给出“建议责任部门”，不得包含根负责人或具体执行人下拉框；人员选择属于原任务分配系统。
- 正式分配前可保存/修改草稿；分配后修订生成 `V2/V3`，不得覆盖 `V1`。
- 分类或分析修改只生成新初析版本；任务要求/期限修改必须提示并同步原任务系统；负责人/执行人修改必须跳回原任务分配链路。

#### 任务分配复用与数据权威

- 质量模块只把事件编号、标题、公开摘要、质量初析、处理要求、建议部门和期限作为任务草稿传入原任务分配入口；原任务分配 UI 与行为保持不变。
- 分配完成后，质量页只读展示 `qualityEventId`、`qualityNodeId`、`taskId`、`subtaskId`、`integrationKey`、主管、执行人、期限和状态。
- `integrationKey = quality-node:{nodeId}`，创建必须幂等；质量库只保存关联和质量上下文，不复制正式任务状态。
- 正式任务 SQLite 是负责人、执行人、期限、进度、承接与验收状态的唯一权威源；“调整分配”只能打开原任务系统。
- 质量页责任链由正式任务关联结果投影生成，只允许查看、聚合证据和发起质量退回，不允许新增节点、直接改人或产生第二套任务状态。

#### 页面信息架构与视觉规范

- 统一系统中原任务分配区域保持原位和原交互；新增质量追踪放在页面下方，不重做现网任务分配。
- 质量列表位于上方全宽；选中记录后，来源事实 → AI 原始建议 → 主管最终研判 → 质量初析 → 原任务分配结果 → 责任链/证据 → 终验，均在列表下方全宽展开。
- 禁止把质量初析等长表单塞入右侧窄栏；禁止重复的根负责人分配表单。
- 页面主标题 `22–24px`，区域标题 `18px`，卡片标题 `16px`，正文/输入内容 `14px`，辅助信息不得小于 `12px`；输入与主要按钮高度至少 `42px`，多行文本行高 `1.65–1.75`。
- 重点验证 `1366×768` 与 `1920×1080`；避免狭窄三栏、长距离内层滚动、大量 8–10px 关键文字、过度渐变/紫色/阴影和同质卡片堆叠。
- 视角演示使用管理员/主管/员工三个基础视角；员工侧以“质量管理能力已开通”标记附加权限，不再显示成独立角色。

#### 目标状态与验收

- 来源状态：`UNREVIEWED → ORDINARY | NEEDS_INFO | REPORTED`；来源版本更新必须触发重新确认而不是静默覆盖。
- 质量事件目标状态：`PENDING_ANALYSIS → PENDING_ASSIGNMENT → PENDING_ACCEPTANCE → IN_PROGRESS → PENDING_PRIMARY_REVIEW → PENDING_QUALITY_REVIEW → CLOSED`，另含退回、重开和超期语义。
- 测试至少覆盖：admin 业务只读、质量能力门禁、AI 快照不可覆盖、修改原因校验、初析版本、任务桥接幂等、单一状态权威、改派只能走原系统、关闭/重开审计和两种桌面分辨率。
- HTML 原型是交互评审件：必须新建修改版文件，不覆盖用户原型；除非用户明确说“开始修改”，需求确认阶段不得编辑 HTML 或正式源码。
- 实施顺序：需求/权限确认 → 新 HTML 原型 → 用户评审 → 正式前端 → API/SQLite/权限迁移 → 回归与视觉验证；每阶段不得提前宣称后续阶段已完成。

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

## 每日早报汇总（Daily Report Digest，v1）

- **定位**：跨组织早报汇总，Admin 配置采集名单 → 每日 8:30（`DAILY_REPORT_DIGEST_HOUR=8`，`MINUTE=30`）向指定钉钉群发送综述 Markdown；工作台提供只读汇总页（`DAILY_REPORTS_PAGE_ENABLED=1`）与名单管理（Admin only）。
- **组织隔离**：明思实例默认开启（`DAILY_REPORTS_PAGE_ENABLED=1`），微光默认关。两个实例共用同一镜像，通过 env 分叉。
- **早报来源**：员工钉钉群日报文本（`DAILY_REPORT_DIGEST_CONFIG_FILE` 中配置 webhook + 人员名单）；每日扫描后 LLM 综述（`DAILY_REPORT_MORNING_LLM_ENABLED=1`，可选，默认 `qwen3.6-flash`，8:30 前生成）。
- **附件识别**：支持图片/附件链接摘要（Phase 1 识别展示）。
- **月归档 / 三段式**：早报页支持月维度归档；综述分「项目进展 / 风险提示 / 下一步」三段式结构。
- **工作台名单管理**：Admin 通过工作台搜人 + 增删，**不暴露给普通主管**；近 7 天日报校验防误删。
- **实现**：`src/agent/daily-report-digest/`；scheduler 与催办/进展推送并列启动；`DAILY_REPORT_DIGEST_ENABLED=1` 开关。

| 变量 | 默认 | 说明 |
|------|------|------|
| `DAILY_REPORTS_PAGE_ENABLED` | `0` | 工作台日报汇总页入口 |
| `DAILY_REPORT_DIGEST_ENABLED` | `0` | 8:30 群推 scheduler |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | `data/daily-report-digest.config.json` | 名单 + webhook 配置 |
| `DAILY_REPORT_DIGEST_TIMEZONE` | `Asia/Shanghai` | 发送时区 |
| `DAILY_REPORT_DIGEST_HOUR` | `8` | 群推小时 |
| `DAILY_REPORT_DIGEST_MINUTE` | `30` | 群推分钟 |
| `DAILY_REPORT_DIGEST_WEEKDAYS_ONLY` | `1` | 仅工作日发送 |
| `DAILY_REPORT_MORNING_LLM_ENABLED` | `1` | LLM 综述开关 |
| `DAILY_REPORT_MORNING_LLM_MODEL` | `qwen3.6-flash` | 综述模型 |
| `DAILY_REPORT_MORNING_LLM_TIMEOUT_MS` | `12000` | LLM 超时 |

### 微光 projectView 早报（managebot 1:1）

- **CTO 合并卡片**：`DAILY_REPORT_CTO_ROLLUP_DIGEST_ENABLED=1`（默认）→ 曹等 viewer 收 **1 条**「全部项目」汇总；每项目 plain text overview 缓存于 `daily_report_project_view_cache.ctoOverview`。
- **工作台**：项目详情展示 LLM **逐人简述**（`personBriefs`）；「全部项目」Tab `custom:overview`。
- **时序**：prewarm **06:45** → send **07:00**（`digest.sendHour` 可 per-view 配置）；`DAILY_REPORT_PROJECT_VIEW_PREWARM_*` / `DAILY_REPORT_MORNING_LLM_MAX_TOKENS`（默认 2000）可调。

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
- **UI 增强**：四状态交付堆叠图、单员工详情项目过滤、多轮对话记忆（`performance` profile 专用 `promptProfile`）；Admin 全员视角，主管仅本人名下。
- **API**：`GET /api/workbench/manager/performance`、`POST /api/workbench/manager/performance/chat`。

## 能力评估（Competency Eval，v1）

- **定位**：对照用户上传的 rubric 与钉钉日报，对被评估人做**定性**能力复盘与辅导建议（非交付 KPI、不改动任务）。
- **页面**：`/workbench/manager/competency-eval`（`COMPETENCY_EVAL_ENABLED=1` + 白名单 `COMPETENCY_EVAL_USER_IDS`）；ChatGPT 风格 UI：侧栏会话历史（可收起）、服务端持久化、上传 `.md`/`.docx` 标准。
- **试点**：微光 managebot（曹一挥、姚凯珩白名单）；部署脚本 `scripts/ecs-deploy-competency-eval-managebot.sh`。
- **隔离 Agent**：`promptProfile=competency_eval` + `toolProfile=competency_eval`（`list_rubrics` / `get_rubric` / `get_employee_daily_reports` / `search_employees` / `get_current_time`），入口 `runCompetencyEvalTurn`（`src/agent/competency-eval/competency-eval-agent-turn.ts`），不接 planner 草案/发放 FSM。
- **数据**：rubric 与评估会话存 `data/competency-eval/`（`COMPETENCY_EVAL_DATA_DIR`）；日报证据来自 digest 配置的 roster（与早报采集名单联动）。
- **LLM**：复用 `buildManagerQwenClientConfig` 超时/流式；**thinking 默认开**（`COMPETENCY_EVAL_QWEN_THINKING`，与钉钉主链路 `DINGTALK_QWEN_THINKING` 独立）。
- **API**：`GET/POST /api/workbench/competency-eval/sessions`、`GET/POST rubrics`、`POST .../chat`（SSE 流式）。

| 变量 | 默认 | 说明 |
|------|------|------|
| `COMPETENCY_EVAL_ENABLED` | `0` | 功能开关 |
| `COMPETENCY_EVAL_USER_IDS` | — | 白名单 userId（逗号分隔） |
| `COMPETENCY_EVAL_DATA_DIR` | `data/competency-eval` | rubric + 会话目录 |
| `COMPETENCY_EVAL_QWEN_THINKING` | `1`（隐式） | 能力评估 LLM thinking |

## 承接指派（v0.2 MVP）

`ASSIGNMENT_PHASE_ENABLED=1` 时，orchestrator **同一次 ReAct 请求**产出 `assignment` JSON → `extractLightAssignment` → 拼入回复 Markdown。**无第二次独立 LLM**（`runAssignmentRecommendation` 仅测试/独立调用）。

- **Web 工作台**：HMAC-SHA256 签名 URL（30min TTL）；端口 `ASSIGNMENT_WEB_PORT`（默认 8787）。
- **Mock 卡片**：`DINGTALK_ASSIGNMENT_MOCK=1`。
- **花名册点将**：`read_uploaded_roster_text` → `resolve_roster_names` → `set_candidate_pool`（**须填 `fileNotes`**），避免逐条 search（见 backlog M-13）。

### 运维配置（节选）

| 变量 | 说明 |
|------|------|
| `ORCHESTRATOR_ENGINE` | `v2` 启用 LangGraph 编排器（默认 `legacy`；ECS 现网已设 `v2`） |
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
| `DAILY_REPORTS_PAGE_ENABLED` | 工作台日报汇总页（默认 `0`；明思实例开 `1`） |
| `DAILY_REPORT_DIGEST_ENABLED` | 8:30 群推 scheduler（默认 `0`） |
| `DAILY_REPORT_DIGEST_CONFIG_FILE` | 名单 + webhook 配置文件路径 |
| `COMPETENCY_EVAL_ENABLED` | 能力评估页 + API（默认 `0`；白名单 `COMPETENCY_EVAL_USER_IDS`） |
| `COMPETENCY_EVAL_QWEN_THINKING` | 能力评估 LLM thinking（默认开；`0` 关闭） |
| `PERFORMANCE_DASHBOARD_ENABLED` | 员工交付绩效看板（默认 `1`） |
| `PERFORMANCE_WINDOW_DAYS` | 绩效统计窗口自然日（默认 `90`） |

**发布后文案修正**：工作台暂无「已发布任务在线改字」；运维可对 SQLite `tasks`/`subtasks` 做定向 UPDATE（示例脚本 `scripts/patch-meeting-subtask-titles.ts`），**不会**自动重发通知。

## Agent Harness 基线

- **编排**（legacy）：`runOrchestrator` → `QwenCompatibleClient.callWithTools`；中间 tool 轮静默，最终 `end_turn` 的 message 对用户可见。
- **编排**（v2）：`runManagerTurnV2` → LangGraph `StateGraph`（`tools_node` ↔ `llm_node`）→ 事务化补跑（Turn Contract）；`ORCHESTRATOR_ENGINE=v2` 激活。
- **审计**：`orchestrator_done` / `orchestrator_max_turns_exceeded`；有草案时 `data/plans/<traceId>.json` 快照；demo 链路另写 `AUDIT_DEMO_JSONL_PATH`。
- **护栏**：PII 脱敏（`content-filter.ts`）、会话 TTL + 限速（`session-store.ts`）。
- **会话 TTL**：默认 30min（`CHAT_SESSION_TTL_MS`）。

### 开发顺序

1. ✅ ReAct orchestrator + profile 分工具
2. ✅ 短期 / 中期 / 长期记忆
3. ✅ 承接指派 v0.2 + Web 工作台 + SQLite 正式任务
4. ✅ 钉钉集成（免登、通知、通讯录、员工侧工具）
5. ✅ 催办 v1 + 每日进展推送 v1
6. ✅ v2 LangGraph 编排器 + Turn Contract 事务化补跑
7. ✅ 每日早报汇总 v1 + 员工绩效看板 v1 + 任务快录入库 v1.2
8. ⏳ 承接三态（钉钉卡片）、节点反馈、验收闭环、OA 同步

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
| V1.1 | 催办、进展推送、WBS 细拆、Scheme C、角色路由、eval 回归集 | ✅ |
| V1.2 | 双钉钉实例（mingsibot）、Admin 权限中心、动态主管名单、Portfolio 会议入库、任务快录入库（AI 多父任务分组 + 追加已有） | ✅ 试点 |
| V1.3 | **v2 LangGraph 编排器**（Turn Contract 事务化补跑、Frontier 工具门控）；每日早报汇总 v1；员工绩效看板 v1；`bulk_assign_tasks` fillDefault + split_draft_task allTaskIds 可靠性修复 | ✅ 现网 |
| V2 | 钉钉卡片承接三态、执行中变更、节点反馈、验收闭环 | ⏳ |
| V3 | OA/QMS 联动、电子签名、管理报表 | ⏳ |
