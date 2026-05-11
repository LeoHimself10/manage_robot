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

## 当前实现边界（2026-05-11）

- **主链路**：钉钉消息 → **`runOrchestrator`（ReAct loop + tool calling）**→ 结构化草案补表 + 可选指派推荐 + Plan 快照。`createTaskPlanningDemo` 保留给 CLI/demo/eval 回归链路。
- **模型**：`qwen3.6-plus`（DashScope），支持 function calling。`QWEN_MODEL` 默认 `qwen3.6-plus`（见 `model-policy.ts`），`QWEN_THINKING` 默认开启（`QWEN_THINKING=0|false|no` 关闭）。
- **提示词**：`orchestrator-agent-v5.2`（`src/agent/demo/qwen-prompt.ts`），`runOrchestrator` 与 `generateStructuredPlan` 共享同一 system prompt 源。
- **工具**（`src/agent/tools/`）：`list_known_facts`、`update_known_facts`、`search_web`、`search_similar_plans`（embedding + cosine）、`save_draft`（以 coerce 为主，尽量少硬校验）、`search_employees`（假员工档案 10 人）。
- **短期记忆**：`knownFacts[]`（session-store），模型通过 `update_known_facts` / `list_known_facts` 自主维护。
- **长期记忆**：`plan-index.ts`（embedding + cosine 文件遍历），`search_similar_plans` 工具触发。
- **兜底**：自然语言回复自动包装为 `{ message, stopReason: "end_turn" }`；空消息有最终 fallback。
- **不做**：OA 自动流程、承接三态、电子签名、执行中变更、节点反馈与验收闭环。

## 承接指派阶段（v0.2 MVP）

当前承接指派为 v0.2 MVP，**尚未**实现完整 承接三态（accept/modify/reject）；该阶段在草案生成后触发第二次 LLM 推荐，提供人员推荐与指派预览。

### 启用方式

- **`ASSIGNMENT_PHASE_ENABLED=1`**：开启指派阶段。未设置或为 `0` 时，行为与原有 DRAFT_READY 一致（不触发指派）。
- **发起人白名单**：`src/security/initiator-whitelist.ts` 已提供函数与测试，但当前 `src/dingtalk-bot.ts` 主链路暂未接入该检查。

### 调用链

1. **先生成草案**：`runOrchestrator` 先返回 `message + draft`。
2. **同请求内追加推荐**：当 `ASSIGNMENT_PHASE_ENABLED=1` 且有 `draft` 时，`dingtalk-bot` 内 `await runAssignmentRecommendation(...)`，成功则把“分配建议”表直接拼到同一条回复 Markdown 中。
3. **`runAssignmentRecommendation`**：第二次 LLM 调用（规划之后的独立调用），采用 **单轮 function calling**（`search_employees` 工具）。模型根据草案内容与人员库信息，推荐合适的人员分配。
4. **结构自纠正**：Schema 校验失败时进行 **1 轮重试**（将校验错误反馈给模型要求修正）。若仍失败，放弃本轮推荐。
5. **签名 Web 工作台**：生成 **HMAC-SHA256** 签名的工作台 URL（**30 分钟 TTL**，**manager 角色**），发起人可点击链接查看并调整推荐。
6. **Mock 钉钉交互卡片**：在 `DINGTALK_ASSIGNMENT_MOCK=1` 下，使用本地 mock 的钉钉交互卡片进行预览，无需真实钉钉卡片回调。

### 运维配置

| 变量 | 必填 | 说明 |
|------|------|------|
| `ASSIGNMENT_PHASE_ENABLED` | 否 | `1` 开启指派阶段 |
| `TASK_INITIATOR_USER_IDS` | 否 | 发起人白名单（当前主链路暂未生效，保留为后续接入项） |
| `TASK_INITIATOR_IDS_FILE` | 否 | 发起人白名单文件路径（当前主链路暂未生效） |
| `ASSIGNMENT_WEB_PORT` | 否 | 工作台 Web 端口（默认 `8787`） |
| `ASSIGNMENT_WEB_PUBLIC_BASE_URL` | 否 | 工作台公网地址（ECS 公网 host） |
| `ASSIGNMENT_WEB_SECRET` | 否 | HMAC-SHA256 签名密钥 |
| `DINGTALK_ASSIGNMENT_MOCK` | 否 | `1` 启用 mock 钉钉交互卡片 |

## Agent Harness 基线

### 现网架构（2026-05-11）

- **编排方式**：`runOrchestrator`（ReAct loop），模型自主决定调用工具。无硬编码状态机。
- **工具调用**：`QwenCompatibleClient.callWithTools` 处理 OpenAI compatible tool_calls 协议。默认最多 6 轮工具迭代（可通过 `maxIterations` 覆盖）。
- **护栏**：PII 脱敏（`content-filter.ts`）、会话限速（`session-store.ts`）；`save_draft` 以“保存优先、结构归一化优先”为主，尽量减少硬门禁阻断模型。
- **审计**：每次 orchestrator 完成写 `orchestrator_done` 事件（含 traceId/toolCallsTotal/hasDraft/messageChars）。`appendDemoRunAudit` 主要用于 `createTaskPlanningDemo` demo/eval 链路。
- **会话**：`knownFacts[]` 模型自主维护，TTL 30min。`conversationState` 用于 digest 拼接。
- **指派**：`ASSIGNMENT_PHASE_ENABLED=1` 时，当前在同一请求内同步运行 `runAssignmentRecommendation` 并拼接分配建议。

### 编排方式
- 单次 `callWithTools`，模型自主决定调多少轮工具（默认 max 6 iterations）。
- 输出消息仅取最终 `end_turn` 轮的 message。中间 `tool_use` 轮次静默。
- 审计事件：`orchestrator_done` + `orchestrator_max_turns_exceeded`。

### 开发顺序

1. ✅ Demo/MVP 主链路：ReAct orchestrator + 6 tools + function calling
2. ✅ 短期记忆：knownFacts 模型自主维护
3. ✅ 长期记忆：embedding + cosine 文件遍历
4. ✅ 承接指派 v0.2：search_employees + Web 工作台骨架
5. 待推进：承接三态、节点反馈、验收闭环、OA 同步

## 工程约束

- 提示词、模型策略与输出 Schema 必须**可版本化、可配置**；业务编排层禁止写死具体拆解文案替代模型职责。
- `coerce`/归一化层只能做类型与兼容别名处理（trim、string array、旧字段名映射等），不得把缺失核心字段补成看似可派发的默认文案。
- Demo 阶段优先保证“模型可写、系统可存”，尽量减少由代码硬门禁导致的阻断。
- 完整闭环阶段派发门禁默认硬阻止；如开启豁免，必须记录豁免原因与操作者。
- 完整闭环阶段不允许“沉默承接”：超时提醒后必须升级。
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
