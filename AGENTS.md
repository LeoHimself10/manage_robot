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

## 当前实现边界

- 当前 Demo/MVP 主链路：**基础输入护栏**（空输入等 + **`INPUT_MAX_CHARS` 超长则追问、不静默截断**）→ **Qwen 结构化输出**（信息充分性判断、追问、场景分类、任务包/WBS、质量域 CAPA 建议、门禁自检；可选 **`sessionDigest` 上轮摘要**）→ **结构校验与派发门禁二次确认**（含 **`consistency` 依赖/环等 warnings 合入 `gate.warnings`**）→ **Markdown/表格输出**（`DRAFT_READY` 前对正文做 **手机号/身份证/IPv4** 级脱敏，**无**政治词黑名单）→ **JSONL 审计落盘**（每轮 `createTaskPlanningDemo` 完结一行，见 `AUDIT_DEMO_*`）与可选 **Plan 文件快照**（`PLAN_STORE_DIR`）。须配置 `QWEN_API_KEY`（见 `.env.example`）。**不存在**关键词分类、规则 CAPA、subtype 固定骨架等无模型生成路径；校验或模型失败返回 `GENERATION_FAILED`，**不用规则稿顶替**。
- **钉钉 Stream 试点**（`npm run dingtalk-bot`，部署见 **`docs/deploy-aliyun-dingtalk.md`**）：单次用户消息 **仅一条 Markdown 终稿气泡**（追问 / 拆解稿 / 失败说明），**不向用户推送**「处理中」或流式进度等中间气泡。追问文案来自模型 **`openQuestions`**，**无前导列表符号、无拼接式固定追问标题**。`QWEN_STREAM` **默认 SSE**（`QWEN_STREAM=0` 关；仅服务端拼装 JSON，与钉钉展示条数无关）。提示词版本见 `src/agent/demo/qwen-prompt.ts`（当前 **`task-planning-agent-v2.8`**）；JSON 可选 **`clarificationUx`**（`NON_TASK`|`TASK_GAP`）。Windows 与服务端一键更新：`scripts/ecs-deploy-dingtalk.ps1`。
- **调用链（pipeline）**：`runQwenPlanner` 仅解析模型 JSON 并带上 `traceId`；`createTaskPlanningDemo` 内对同一 payload **单次** `coerce` → `validate`（`LOW` 追问形状时允许空 `tasks`）→ 可选 **一轮结构自纠正** → 状态分流与 `gate`；请勿在 planner 与 pipeline 重复 coerce。
- **确定性规则**仅用于约束 AI：空输入等基础护栏、`llm-schema` 结构/域约束（如质量域必含 CAPA、研发域不含）、`gate` 四必填硬校验与 LLM 自检一致性确认；不负责在无 LLM 时生成完整草案，也不得为交付物、完成标准、截止时间、反馈频率等核心业务字段填充语义默认值。
- 当前 Demo/MVP 不做 OA 自动流程、承接三态、电子签名、执行中变更、节点反馈与验收闭环。
- CAPA 字段仅为建议，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。
- HR 简历/能力清单可能过时，Demo 阶段不把 HR 推荐作为核心能力；后续若展示推荐，必须显示来源与更新时间。

## Agent Harness 基线

### 核心职责
- 输入质检（由 LLM 判断语义充分性并反问；代码只做空输入等基础护栏，不用关键词正则替代语义判断）
- **Demo 当前**：由大模型输出分类与子类型，受 Schema 与提示词策略约束（非代码内关键词/固定骨架模板）
- WBS 与任务包由模型生成，依赖关系由模型输出后经门禁校验（完整 Harness 中可与Planner/模板版本长期对齐）
- 派发门禁校验（交付物、完成标准、时间节点、反馈频率；LLM 自检 + 代码二次硬校验）
- 承接三态处理（确认/修改/拒接）
- 节点反馈收集（进展、证据、风险）
- 提醒升级与审计留痕

### 编排方式
- 采用“事件驱动 + 显式状态机”。
- 业务状态需可回放；关键动作必须写入审计事件。
- **Demo 现网（钉钉）**：仅走 `createTaskPlanningDemo`，Harness `AuditSink` 主要服务编排层 Plan 事件；**双轨审计**见 `docs/deploy-aliyun-dingtalk.md`（`AUDIT_DEMO_JSONL_PATH` vs `AUDIT_SINK=file`）。
- 外部交互（钉钉/HR）必须幂等，并具备失败补偿。

### 建议状态
- Plan：`DRAFT` / `IN_REVIEW` / `BLOCKED_BY_GATE` / `DISPATCHED` / `NEGOTIATING` / `IN_EXECUTION` / `IN_ACCEPTANCE` / `DONE`
- Assignment：`PENDING_CONFIRM` / `ACCEPTED` / `REQUEST_CHANGES` / `REJECTED` / `TIMEOUT_ESCALATED`

## 开发顺序（执行要求）

1. 先实现 Demo/MVP 主链路：输入质检、Qwen 结构化生成（分类/CAPA/WBS）、派发门禁、Markdown/表格输出。
2. 再基于质量提供的真实样本优化**提示词、输出 Schema 与门禁口径**（效果指标仍是分类合理率、CAPA 接受度、WBS 可用性等）。
3. 再实现 HR 推荐增强、发起人编辑视图与 Demo 到 Harness 的适配。
4. 最后推进承接三态、任务变更、节点反馈、验收、OA 同步、电子签名与外部 Agent 链接。

## 工程约束

- 提示词、模型策略与输出 Schema 必须**可版本化、可配置**；业务编排层禁止写死具体拆解文案替代模型职责。
- `coerce`/归一化层只能做类型与兼容别名处理（trim、string array、旧字段名映射等），不得把缺失核心字段补成看似可派发的默认文案。
- Demo 阶段门禁未通过时只输出缺失项清单，不标记为可派发稿。
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
