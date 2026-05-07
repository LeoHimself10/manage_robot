# AGENTS

## 项目目标

本项目用于实现“钉钉任务规划与承接确认机器人”，核心是通过 Agent Harness 将模糊任务转为可承接、可验收、可追溯的任务闭环。

## 参考文档

- PRD：`docs/PRD-钉钉任务规划与承接确认机器人.md`
- 流程图：`docs/PRD-钉钉任务规划与承接确认机器人-场景流程图.md`
- Demo MVP 设计：`docs/superpowers/specs/2026-05-07-task-planning-demo-mvp-design.md`
- Demo MVP 实施计划：`docs/superpowers/plans/2026-05-07-task-planning-demo-mvp.md`
- Harness 设计与计划：`docs/agent-harness-架构与开发计划.md`

## 当前实现边界

- 当前 Demo/MVP 先验证“输入质检 -> 场景分类 -> CAPA 建议 -> WBS 草案 -> 任务包 -> 派发门禁 -> Markdown/表格输出”。
- 当前 Demo/MVP 不做 OA 自动流程、承接三态、电子签名、执行中变更、节点反馈与验收闭环。
- CAPA 字段仅为建议，最终是否开启 CAPA 以质量授权人员和公司 QMS 流程判定为准。
- HR 简历/能力清单可能过时，Demo 阶段不把 HR 推荐作为核心能力；后续若展示推荐，必须显示来源与更新时间。

## Agent Harness 基线

### 核心职责
- 输入质检（缺信息先追问，不生成空洞计划）
- 场景模板选择（质量/研发 + 子类型）
- WBS 与任务包生成（含依赖关系）
- 派发门禁校验（交付物、完成标准、时间节点、反馈频率）
- 承接三态处理（确认/修改/拒接）
- 节点反馈收集（进展、证据、风险）
- 提醒升级与审计留痕

### 编排方式
- 采用“事件驱动 + 显式状态机”。
- 业务状态需可回放；关键动作必须写入审计事件。
- 外部交互（钉钉/HR）必须幂等，并具备失败补偿。

### 建议状态
- Plan：`DRAFT` / `IN_REVIEW` / `BLOCKED_BY_GATE` / `DISPATCHED` / `NEGOTIATING` / `IN_EXECUTION` / `IN_ACCEPTANCE` / `DONE`
- Assignment：`PENDING_CONFIRM` / `ACCEPTED` / `REQUEST_CHANGES` / `REJECTED` / `TIMEOUT_ESCALATED`

## 开发顺序（执行要求）

1. 先实现 Demo/MVP 主链路：输入质检、场景分类、CAPA 建议、WBS 生成、派发门禁、Markdown/表格输出。
2. 再基于质量提供的真实样本优化分类、CAPA 建议和任务模板。
3. 再实现 HR 推荐增强、发起人编辑视图与 Demo 到 Harness 的适配。
4. 最后推进承接三态、任务变更、节点反馈、验收、OA 同步、电子签名与外部 Agent 链接。

## 工程约束

- 模板与策略配置必须版本化，禁止硬编码在业务流程中。
- Demo 阶段门禁未通过时只输出缺失项清单，不标记为可派发稿。
- 完整闭环阶段派发门禁默认硬阻止；如开启豁免，必须记录豁免原因与操作者。
- 完整闭环阶段不允许“沉默承接”：超时提醒后必须升级。
- 正式 QMS/CAPA 记录不由本系统自动关闭，本系统仅维护协作层状态。

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

- Demo/MVP：打通“输入质检 -> 分类 -> CAPA 建议 -> WBS -> 门禁 -> Markdown/表格输出”。
- V1.1：真实样本回归集、分类模板优化、发起人编辑视图、人岗推荐可信度提示。
- V2：承接三态、执行中延期/无法完成申请、换人审批、节点反馈、验收闭环。
- V3：与钉钉 OA/QMS/项目系统联动、电子签名、外部 Agent 链接与管理报表扩展。
