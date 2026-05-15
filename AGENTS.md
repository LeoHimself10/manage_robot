# AGENTS

## 项目目标

本项目用于实现“钉钉任务规划与承接确认机器人”，核心是通过 Agent Harness 将模糊任务转为可承接、可验收、可追溯的任务闭环。

## 参考文档

- PRD：`docs/PRD-钉钉任务规划与承接确认机器人.md`
- 流程图：`docs/PRD-钉钉任务规划与承接确认机器人-场景流程图.md`
- Demo MVP 设计：`docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md`
- Demo MVP 实施计划：`docs/superpowers/plans/2026-05-07-task-planning-demo-mvp.md`
- Harness 设计与计划：`docs/agent-harness-架构与开发计划.md`
- Qwen 接入与运行：`docs/Qwen-接入实施说明.md`
- 阿里云部署与钉钉 Stream 机器人：`docs/deploy-aliyun-dingtalk.md`
- Demo 工程增强清单（审计 / 会话 / 可观测性等）：`docs/harness-next-optimizations.md`
- Pipeline 薄封装重构设计档案：`docs/harness-pipeline-refactor-plan.md`

## 当前实现边界（2026-05-12）

- **主链路**：钉钉消息 → **`runOrchestrator`（ReAct loop + tool calling）**→ 结构化草案补表 + 可选指派推荐 + Plan 快照。`createTaskPlanningDemo` 保留给 CLI/demo/eval 回归链路。
- **模型**：DashScope OpenAI 兼容接口；仓库默认策略见 `model-policy.ts`。线上可通过 **`QWEN_MODEL`** 切换（例如 **`qwen3.6-flash`** 降低延迟，需自行验证工具调用与草案质量）。钉钉链路默认 **`DINGTALK_QWEN_THINKING=0`**（关闭 thinking 以降低首包时延）；全局 `QWEN_THINKING` 仍可按环境关闭。
- **提示词**：钉钉 / ReAct 主链路使用 `orchestrator-agent-v5.16`（`buildQwenPlannerSystemPrompt`，含 planner / manager / employee profile）；纪律要点：**禁止未调 `publish_task` 即声称已发布**；**首轮必问期望完成时间/截止日期**（已答则不重复）；**确认/确认发布/发布吧**等宽泛肯定词触发发布、**再改/等等/取消**等否定词禁止发布；**message 与 JSON 顶层 `draft` 同轮落盘**（避免 `hasDraft=false` 断链）；**候选池内以 `search_employees` 为准、禁止「未找到」与身份信息自相矛盾**（纯 prompt，无代码正则兜底）。`generateStructuredPlan` 单次 JSON 链路（`demo` CLI、`demo:eval`、调试脚本）使用独立的 `legacy-demo-planner-v1`（`buildLegacyDemoPlannerSystemPrompt`），描述完整 classification / tasks[*].id / capaAdvisory(QUALITY) / gateSelfCheck schema，与 orchestrator 解耦。
- **工具**（`src/agent/tools/`）：按 profile 暴露。ReAct 主链路已改为**最终 JSON 直接输出 `draft`**（不再依赖 `save_draft` 工具回合）；为了兜底「模型只产 Markdown 表格不产结构化 draft」的退化情况，`prepare_publish_task` 在校验通过时**会把规整后的 draft + assignment 直接写入 `currentSession.latestDraft` / `latestAssignment`**，下一轮的 `publish_task` 才能读到结构化数据。`planner` 默认 `search_employees` / `get_employee_details` / `search_similar_plans`（`SEARCH_SIMILAR_PLANS_ENABLED=0` 时关闭该工具及钉钉侧 plan embedding 写入）/ 条件开放 `search_web` / `get_current_time` / `update_known_facts` / `list_known_facts`（共 7 个）；`manager` 在此基础上提供发布与管理工具（共 12 个）；`admin` 再追加管理视角工具（共 16 个）；`employee` 提供 `list_my_tasks` / `submit_employee_response` / `submit_progress_update` / `update_employee_profile` 等员工侧工具。`search_web` 受 `SEARCH_WEB_ENABLED` 与请求语义双重约束。`search_employees` 默认返回 cap 收紧到 **25**（`SEARCH_EMPLOYEES_MAX_CANDIDATES`），并对**单次 orchestrator 内调用次数**设硬上限 **3**（`SEARCH_EMPLOYEES_PER_ORCHESTRATOR_QUOTA`），超过即返回 `ok:false / search_employees_quota_exhausted` 让模型直接转述，防止"反复换参数搜不到 → ReAct 死循环 / token budget 爆栈"。`publish_task` 遇到 empty draft / missing assignee 不再 throw，改为 `ok:false / no_draft_in_session | missing_assignee` 软返回。
- **钉钉会话与多任务**：同一钉钉会话（`chatKey`）内 `PlanSession` 使用 `taskScopes` 归档；每个 scope 带独立 **`planId`**（与顶层 `session.planId` 在激活时一致）。`start_new_task` 与 **`publish_task` 成功（非 `alreadyPublished` / 非 LRU 去重 / 非 `unknown_assignees`）** 后会自动轮转 **`planId`**，以便同一会话连续发布多条正式任务；旧 scope 保留草案与 `knownFacts`，可用 `switch_back_task` 回切。`**DINGTALK_PLANID_ROTATE_ENABLED=0**` 可关闭发布后自动轮转（默认 `1`）。
- **钉钉角色路由**：`DINGTALK_ROLE_ROUTING_ENABLED=1` 时，钉钉入口按身份动态路由 `manager/employee/planner` profile；默认关闭时保持固定 `planner`（兼容旧行为）。
- **短期记忆**：`knownFacts[]`（session-store），模型通过 `update_known_facts` / `list_known_facts` 自主维护。
- **长期记忆**：`plan-index.ts`（embedding + cosine 文件遍历），`search_similar_plans` 工具触发（受 `SEARCH_SIMILAR_PLANS_ENABLED` 与 `PLAN_EMBEDDING_DISABLED` 约束）。
- **兜底**：自然语言回复自动包装为 `{ message, stopReason: "end_turn" }`；空消息有最终 fallback。
- **不做**：OA 自动流程、承接三态、电子签名、执行中变更、节点反馈与验收闭环。
- **运行时数据源约束**：工作台正式任务仅以 SQLite 为权威源；`tasks.json` 不参与运行时查询与回灌迁移。`tasks` 表 **`description`**（TEXT，可选）：任务整体背景，发布时从 `latestDraft.description`（无则回退 `latestDraft.summary`）写入并截断至 `TASK_DESCRIPTION_MAX_DB`，供钉钉通知、工作台与员工工具消费。`subtasks` 表可选 **`extra_json`**（TEXT），发布时从草案序列化写入：`v:1` 时仅 `{ dependsOn?, checkpoints?, risks? }`（分别对应 `dependencyTaskIds` / `timeNode.checkpoints` / `risksAndOpenQuestions`）；**`v:2`** 在含输入材料/动作/协作人/范围任一项时写入，额外包含 `inputMaterials`、`actions`、`collaborators`、`scope: { inScope[], outOfScope[] }`（与草案 `tasks[]` 同名字段对齐），供详情接口、钉钉发布通知与主管/员工工作台展示。员工画像与通讯录快照也已落在 SQLite 数据层（`people-directory-store`、`dingtalk_contacts`）。**工作台子任务状态**：员工「接受」后子任务直接为 **`IN_PROGRESS`**（不再落库 **`ACCEPTED`**）；启动时会把历史 **`ACCEPTED`** 行迁移为 **`IN_PROGRESS`**，审计事件名 **`SUBTASK_ACCEPTED`** 仍保留。
- **钉钉集成**：已支持发布后员工卡片 + 待办通知（`WORKBENCH_DINGTALK_NOTIFY_ENABLED=1`）与通讯录同步（`DINGTALK_CONTACT_SYNC_ENABLED=1`），通知失败不回滚发布，但在 `warnings` 与任务事件中留痕。**员工拒绝 / 请求调整 / 标记阻塞 / 标记完成**时，在总开关开启且 `WORKBENCH_DINGTALK_NOTIFY_MANAGER_ENABLED` 未关闭（默认开启）的前提下，向主管钉钉 **1:1 机器人会话**推送 Markdown（`notifyManagerOfEmployeeAction`）；投递失败写入 `task_events` 类型 `MANAGER_NOTIFY_FAILED`。

## 承接指派阶段（v0.2 MVP）

当前承接指派为 v0.2 MVP，**尚未**实现完整 承接三态（accept/modify/reject）；该阶段在草案生成后触发第二次 LLM 推荐，提供人员推荐与指派预览。

### 启用方式

- **`ASSIGNMENT_PHASE_ENABLED=1`**：开启指派阶段。未设置或为 `0` 时，行为与原有 DRAFT_READY 一致（不触发指派）。
- **发起人白名单**：`src/security/initiator-whitelist.ts` 已提供函数与测试，但当前 `src/dingtalk-bot.ts` 主链路暂未接入该检查。

### 调用链

1. **先生成草案**：`runOrchestrator` 先返回 `message + draft`。
2. **同请求内追加分配预览**：当 `ASSIGNMENT_PHASE_ENABLED=1` 且有 `draft` 时，`dingtalk-bot` 从 orchestrator 返回的 `assignment` JSON 做轻量校验（`extractLightAssignment`），成功则把「分配建议」段落拼入同一条 Markdown。
3. **`runAssignmentRecommendation`**（测试与可选独立调用）：第二次 LLM 调用，**function calling** 暴露 `search_employees` + **`get_employee_details`**；`search_employees` 默认宽名单 + 本部门优先提示，`get_employee_details` 用于写 rationale 前拉全量画像。主链路钉钉侧当前多从 orchestrator 的 `assignment` JSON 取轻量分配表（见 `dingtalk-bot` / `light-assignment`）。
4. **结构自纠正**：Schema 校验失败时进行 **1 轮重试**（将校验错误反馈给模型要求修正）。若仍失败，放弃本轮推荐。
5. **签名 Web 工作台**：生成 **HMAC-SHA256** 签名的工作台 URL（**30 分钟 TTL**，**manager 角色**），发起人可点击链接查看并调整推荐。
6. **Mock 钉钉交互卡片**：在 `DINGTALK_ASSIGNMENT_MOCK=1` 下，使用本地 mock 的钉钉交互卡片进行预览，无需真实钉钉卡片回调。

### 运维配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `ASSIGNMENT_PHASE_ENABLED` | 否 | `1` 开启指派阶段 |
| `TASK_INITIATOR_USER_IDS` | 否 | 发起人白名单（当前主链路暂未生效，保留为后续接入项） |
| `TASK_INITIATOR_IDS_FILE` | 否 | 发起人白名单文件路径（当前主链路暂未生效） |
| `WORKBENCH_MANAGER_USER_IDS` | 否 | **主管**工作台身份白名单（与发起人独立）；逗号分隔钉钉 `userId`。供后续钉钉网页应用免登/Session 路由判定；未配置则 `isWorkbenchManager` 恒为 false（见 `src/security/workbench-manager-whitelist.ts`） |
| `WORKBENCH_MANAGER_IDS_FILE` | 否 | 主管名单 JSON 数组文件（可选；优先级高于 env 列表） |
| `ASSIGNMENT_WEB_PORT` | 否 | 工作台 Web 端口（默认 `8787`） |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | 否 | 工作台公网地址（ECS 公网 host） |
| `ASSIGNMENT_WEB_SECRET` | 否 | HMAC-SHA256 签名密钥 |
| `DINGTALK_ASSIGNMENT_MOCK` | 否 | `1` 启用 mock 钉钉交互卡片 |
| `WORKBENCH_MANAGER_PROFILE_VERIFY_ENABLED` | 否 | `1` 预留开启主管核验 API（仍为 501 stub）；默认关闭见 `docs/workbench-manager-profile-verify-deferred.md` |

## Agent Harness 基线

### 现网架构（2026-05-11）

- **编排方式**：`runOrchestrator`（ReAct loop），模型自主决定调用工具。无硬编码状态机。
- **工具调用**：`QwenCompatibleClient.callWithTools` 处理 OpenAI compatible tool_calls 协议。默认最多 6 轮工具迭代（可通过 `maxIterations` 覆盖）。
- **护栏**：PII 脱敏（`content-filter.ts`）、会话限速（`session-store.ts`）；`save_draft` 以“保存优先、结构归一化优先”为主，尽量减少硬门禁阻断模型。
- **审计**：每次 orchestrator 完成写 `orchestrator_done` 事件（含 traceId/toolCallsTotal/hasDraft/messageChars）。`appendDemoRunAudit` 主要用于 `createTaskPlanningDemo` demo/eval 链路。
- **会话**：`knownFacts[]` 模型自主维护，TTL 30min。`conversationState` 用于 digest 拼接。
- **指派**：`ASSIGNMENT_PHASE_ENABLED=1` 时，在同一请求内由 orchestrator 产出 `assignment` JSON，经 `extractLightAssignment` 校验后拼入分配建议段落（`runAssignmentRecommendation` 仍保留给测试/独立调用，含 `search_employees` + `get_employee_details`）。

### 编排方式
- 单次 `callWithTools`，模型自主决定调多少轮工具（默认 max 6 iterations）。
- 输出消息仅取最终 `end_turn` 轮的 message。中间 `tool_use` 轮次静默。
- 审计事件：`orchestrator_done` + `orchestrator_max_turns_exceeded`。

### 开发顺序

1. ✅ Demo/MVP 主链路：ReAct orchestrator + 6 tools + function calling
2. ✅ 短期记忆：knownFacts 模型自主维护
3. ✅ 长期记忆：embedding + cosine 文件遍历
4. ✅ 承接指派 v0.2：search_employees + Web 工作台骨架
5. ✅ 工作台正式任务存储：SQLite 正式任务库 + 员工侧动作工具 + 发布预检
6. ✅ 钉钉工作台集成：JSAPI 免登、发布后通知（卡片 + 待办）、通讯录同步
7. 待推进：承接三态、节点反馈、验收闭环、OA 同步

## 工程约束

- 提示词、模型策略与输出 Schema 必须**可版本化、可配置**；业务编排层禁止写死具体拆解文案替代模型职责。
- `coerce`/归一化层只能做类型与兼容别名处理（trim、string array、旧字段名映射等），不得把缺失核心字段补成看似可派发的默认文案。
- Demo 阶段优先保证“模型可写、系统可存”，尽量减少由代码硬门禁导致的阻断。
- 完整闭环阶段派发门禁默认硬阻止；如开启豁免，必须记录豁免原因与操作者。
- 完整闭环阶段不允许“沉默承接”：超时提醒后必须升级；工作台侧员工「接受」后子任务直接为 **IN_PROGRESS**（不落库 **ACCEPTED**），避免中间态被误读为已静默承接。
- 正式 QMS/CAPA 记录不由本系统自动关闭，本系统仅维护协作层状态。

## 测试与可观测

- 单元 / 集成测试：`npm test`（Vitest，`vitest.setup.ts` 默认关闭审计写盘、快照与脱敏侧效应，避免污染 CI）。
- **分段耗时与 traces**：`DemoGenerationMetadata.timings`、`traces[]`；成功草案可打 `logStructured` 单行 JSON（见 `src/infra/logger.ts`）。

## 开发工作区

- 执行实现计划时使用项目内 `.worktrees/` 作为默认 Git worktree 目录。
- `.worktrees/` 必须保持在 `.gitignore` 中，避免误提交隔离工作区内容。
- 不在 `main` 上直接执行功能实现；新功能使用独立 worktree 分支开发。

## 交付定义

每个开发任务最少应包含：
- 对应 FR 编号与验收标准。
- 状态机影响说明（新增状态/迁移/守卫条件）。
- 审计字段影响说明。
- 测试用例（单元 + 流程）更新。

## 里程碑

- Demo/MVP：打通“输入质检 -> Qwen 结构化生成 -> 门禁 -> Markdown/表格输出”（分类与 CAPA 由模型在结构化输出中给出）。
- V1.1：真实样本回归集、分类模板优化、发起人编辑视图、人岗推荐可信度提示。
- V2：承接三态、执行中延期/无法完成申请、换人审批、节点反馈、验收闭环。
- V3：与钉钉 OA/QMS/项目系统联动、电子签名、外部 Agent 链接与管理报表扩展。
