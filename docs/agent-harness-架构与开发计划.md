# 钉钉任务规划与承接确认机器人 Agent Harness 架构与开发计划

## 1. 目标与范围

基于 PRD（当前以 v1.3 为准），本文件定义可落地的 Agent Harness（编排骨架）以及可执行开发计划，用于指导 Demo/MVP 到后续闭环版本的研发实施。早期“模板驱动/承接闭环”表述属于完整 Harness 愿景；当前 Demo/MVP 已收敛为 **Qwen 结构化生成 + Schema/门禁约束**。

V1 聚焦：

- 双域场景入口（质量/研发）与子类型口径。
- 输入质检、WBS 生成、派发门禁、强制承接三态、节点反馈。
- 钉钉交互卡片、提醒升级、审计留痕。
- HR 能力推荐与基础发起人视图（P1 可并行推进）。

不在 V1：

- QMS/CAPA 自动关闭或责任自动裁定。
- 深度双向系统集成、复杂排程优化。

## 2. Harness 设计原则

- **流程可控**：关键节点必须可观测、可回放（审计日志+状态机）。
- **强约束优先**：先保证“任务定义完整性”，再追求智能化。
- **人机协同**：AI 只生成草案，发起人审阅后派发，承接人可拒接/修改。
- **策略驱动**：质量/研发差异通过提示词、模型策略、Schema 与门禁口径实现，核心引擎复用。
- **失败可恢复**：外部依赖（钉钉/HR）失败时可重试、补偿、人工兜底。

## 3. Agent Harness 总体架构

```text
[Channel Adapter: DingTalk]
        |
        v
[Orchestrator Harness]
  |- Session Manager
  |- State Machine Engine
  |- Guardrail & Policy Engine
  |- Planner (Input QA + WBS)
  |- Assignment Recommender (HR)
  |- Acceptance Workflow
  |- Reminder & Escalation Scheduler
  |- Audit Logger
        |
        +--> [Template Registry]
        +--> [Model Gateway]
        +--> [Data Store]
        +--> [Integration Connectors: DingTalk / HR / Optional External IDs]
```

## 4. 核心模块拆分

### 4.1 Channel Adapter（钉钉适配层）

**Demo 现状（Stream）**：会话入口在 `npm run dingtalk-bot`（见 **`docs/deploy-aliyun-dingtalk.md`**）——会话 webhook 回填 Markdown，`NEEDS_MORE_INFO` **仅渲染模型追问正文**（无列表前缀、无自动套话）；与下方「完整 Harness 钉钉卡片」仍为分期关系。

- 接收发起入口（消息、卡片、表单提交）。
- 统一回调签名验签、去重、幂等键注入。
- 将钉钉 payload 适配为内部事件（Domain Event）。

### 4.2 Orchestrator Harness（编排内核）

- 事件驱动状态机，驱动 Plan 全生命周期。
- 统一调用 Policy、Planner、Reminder 等能力模块。
- 负责 saga/补偿：卡片发送失败、回调超时等异常路径。

### 4.3 Guardrail & Policy Engine（规则与门禁）

- 执行 FR-04 四必填校验：交付物/完成标准/时间节点/反馈频率。
- 执行“硬阻止 or 豁免”策略（待决策项可配置开关）。
- 执行角色可见性、权限、字段必填策略（域/子类型差异）。

### 4.4 Planner（输入质检 + 模型生成草案）

- **当前 Demo 实现**：钉钉主链路使用 `src/agent/orchestrator.ts`（ReAct + tool calling），`src/agent/demo/pipeline.ts` 保留给 CLI demo/eval。提示词版本见 `src/agent/demo/qwen-prompt.ts`（当前 `orchestrator-agent-v5.11`），关键词分类 / 模板骨架 WBS / 语义默认补全已移除。主链路草案输出已采用**最终 JSON 直出 `draft`**，不再依赖 `save_draft` 工具回合。
- **完整 Harness 愿景**：编排层仍可聚合「输入质检 → Model Gateway → 门禁 → 人工审阅」；Planner 与提示词模板版本长期对齐 PRD。

### 4.5 Assignment Recommender（人岗推荐）— v0.2 已实现

**已落地**（`src/agent/assignment/`）：
- **现网钉钉主路径**：orchestrator 在 ReAct loop 中自主调用 `search_employees` + `get_employee_details`，把分配结果作为 `assignment` JSON 输出；`dingtalk-bot` 经 `extractLightAssignment` 校验后拼入回复（无第二次 LLM 调用）。
- **`runAssignmentRecommendation`**（备用 / 测试）：function calling 暴露 `search_employees` + `get_employee_details`；`search_employees` 默认宽名单 + 本部门优先提示（不再硬过滤 domain/skills/department/role），`get_employee_details` 在写 rationale 前拉完整 cases/background。Prompt 版本 `assignment-recommender-agent-v0.3.1`（含主管显式指定例外）。
- **1 轮 self-correction**：schema validate 失败时把错误描述回传 LLM 修正。
- **10 名假员工档案**（`fixtures/employees-seed.json`），覆盖质量/研发/供应商/项目管理角色，含 cases（taskType → outcome）、skills、availability。
- **签名 Web 工作台**：HMAC-SHA256 签名的 URL（30min TTL，manager 角色），GET 骨架页面；`handleAssignmentHttp` 与 `/health` 同端口共存。
- **Mock 钉钉卡片**：`DINGTALK_ASSIGNMENT_MOCK=1` 时写 JSONL 行而非调用真实卡片 API。

**待推进：**
- 对接真实 HR 能力清单（FR-05），替换假员工档案为实际数据
- 承接三态（确认/修改/拒接）与卡片回调
- 主管手动覆盖与理由留痕（Web 工作台 POST 覆盖已预留接口）
- 多轮 function calling（当员工池 > 100 时扩展）
- 长期记忆沉淀（Track Record → Derived Profile）

### 4.6 Acceptance Workflow（承接与验收工作流）

- 承接三态：确认承接/需要修改/无法承接（FR-06）。
- 节点反馈模板化问卷（FR-08）。
- 验收通过/退回，驱动任务闭环状态变化。

### 4.7 Reminder & Escalation Scheduler（提醒升级）

- 承接超时提醒、二次超时升级（FR-07）。
- 节点到期提醒与阻塞通知。
- 策略配置化：时长阈值、升级路径、静默时段。

### 4.8 Audit Logger（审计）

- **完整 Harness**：记录派发、修改、承接、升级、验收等；支持追溯「谁在何时做了什么变更」。
- **当前代码**：
  - `createHarness` / `bootstrap` 可选用 **`AUDIT_SINK=file`**，由 `AuditSink` 写入 **`AUDIT_JSONL_PATH`**（JSONL）。
  - **钉钉主线**：`runOrchestrator` 输出结构化日志（如 `orchestrator_done`）并写 `data/plans` 快照；**Demo JSONL** 主要用于 `createTaskPlanningDemo` 回归链路。详见 **`docs/deploy-aliyun-dingtalk.md`**。

## 5. 状态机（建议）

### 5.1 Plan 主状态

- `DRAFT`：发起中，信息可编辑。
- `IN_REVIEW`：AI 草案已生成，发起人审阅中。
- `BLOCKED_BY_GATE`：门禁未通过，等待补全或豁免。
- `DISPATCHED`：已派发给承接人。
- `NEGOTIATING`：存在修改/拒接，发起人汇总修订中。
- `IN_EXECUTION`：承接确认完成，进入执行反馈。
- `IN_ACCEPTANCE`：待验收。
- `DONE`：验收通过完成。
- `CLOSED_WITH_RISK`：终止/不通过关闭（可选）。

### 5.2 Assignment 子状态（每位承接人）

- `PENDING_CONFIRM` -> `ACCEPTED | REQUEST_CHANGES | REJECTED`
- 超时路径：`PENDING_CONFIRM` -> `TIMEOUT_REMIND_SENT` -> `TIMEOUT_ESCALATED`

### 5.3 Feedback 子状态

- `NOT_DUE` -> `DUE` -> `SUBMITTED | OVERDUE`

## 6. 数据契约（对应 PRD 逻辑模型）

建议最小对象：

- `Plan`：域、子类型、背景、约束、发起人、当前状态、外部引用。
- `TaskPackage`：目标、范围边界、输入、动作、交付物、完成标准、节点、频率、依赖。
- `Assignment`：负责人/协作人、承接状态、变更原因、时间戳。
- `FeedbackEvent`：节点、类型、内容、附件、风险标记。
- `Acceptance`：验收人、结果、备注、时间。
- `AuditEvent`：动作、操作者、前后快照、来源渠道、trace_id。

## 7. 目录与工程建议

```text
src/
  adapters/
    dingtalk/
    hr/
  agent/
    harness/
      orchestrator.ts
      state-machine.ts
      policies.ts
      saga.ts
    planner/
      input-qa.ts
      # Demo 阶段任务拆解见 src/agent/demo/（Qwen + schema + gate）
    workflow/
      dispatch.ts
      assignment.ts
      feedback.ts
      acceptance.ts
    reminders/
      scheduler.ts
      escalation.ts
    prompt-registry/
      quality/
      rd/
    model-gateway/
    audit/
  domain/
    plan.ts
    task-package.ts
    assignment.ts
    feedback.ts
  infra/
    persistence/
    queue/
    config/
```

## 8. 分阶段开发计划

### Phase 0：需求冻结与技术基线（2-3 天）

- 锁定 5 个待决策项（门禁策略、质量子类型、研发追溯、HR 字段、验收权）。
- 完成接口清单：钉钉卡片回调、HR 数据读取、附件存储。
- 输出技术设计评审稿（状态机、数据模型、错误码、幂等策略）。

### Phase 1：完整 Harness 核心链路（7-10 天，当前 Demo/MVP 之后）

- FR-01/02/03：场景入口 + 输入质检 + 模型生成 WBS 草案。
- FR-04：派发门禁（默认硬阻止，豁免策略可开关）。
- FR-06：承接三态卡片/表单与状态回写。
- FR-07：超时提醒与升级基础策略。
- FR-08：节点反馈模板（根因/验证/方案三类）。
- 验收标准：完整 Harness 阶段可跑通“发起 -> 承接 -> 反馈 -> 验收”主链路；当前 Demo/MVP 只要求“输入质检 -> Qwen 结构化生成 -> 门禁 -> Markdown/表格输出”。

### Phase 2：稳定性与可运营（5-7 天）

- FR-05：HR 推荐理由 + 数据时效展示。
- 审计留痕与关键报表字段沉淀（用于后续指标）。
- 异常补偿与重试（钉钉发送失败、回调重复、外部超时）。
- 回归测试 + 压测（关键路径分钟级响应）。

### Phase 3：V1.1 增强（按优先级滚动）

- FR-09：发起人待确认/阻塞/临期视图。
- 提示词/Schema/字段策略后台配置化（后续可再加入问卷模板）。
- 与钉钉待办/审批流程轻集成。

## 9. 测试与验收策略

- **单元测试**：状态迁移、门禁校验、提醒策略、幂等处理。
- **契约测试**：钉钉与 HR 适配器输入输出契约。
- **流程测试**：覆盖三态承接、超时升级、验收退回、豁免派发。
- **灰度策略**：先质量域 2-3 子类型 + 研发 2 子类型小范围试点。

## 10. 风险清单（工程视角）

- 外部接口波动：接入层统一重试+熔断+降级提示。
- 提示词与输出质量不稳定：提示词/Schema 版本化与 A/B 对比，保留人工覆盖权。
- 表单负担上升：阶段性压缩必填，逐步引导结构化输入。
- 角色冲突与权限争议：前置权限矩阵并配套审计追溯。

---

本设计可直接作为工程启动基线；如需，我可以继续按该结构生成首版 `src/agent/harness` 目录骨架与 TypeScript 接口定义。