---
status: baseline
last_verified_at: 2026-08-25
verified_against: working-tree
scope: current-quality-tracking-without-ai-and-smart-assignment
maintainer: EDY
---

# 质量追踪快速接手包

本目录是质量追踪模块的快速上下文入口，目标是让新的 Codex 会话先理解已经确认的需求、当前业务流程和 HTML 交互，再只核验本次任务涉及的少量源码。它不能替代源码，但应避免每次无差别扫描整个仓库。

## 当前范围

本基线覆盖：

- 客户反馈来源同步、标准化、快照和来源状态。
- 售后主管的人工研判：普通反馈、待补资料、通报质量异常。
- 质量事件的当前状态、角色、权限、证据、验收、关闭和重开框架。
- 当前真实页面与 HTML 原型的导航、布局、交互、空态、错误态和权限。
- 当前 API、SQLite 表、关键源码和测试入口。
- 录音需求、源码事实、原型设计和待确认问题之间的差异。

## 明确排除

本基线不设计：

- 未来 AI 研判 Agent、模型调用、持续学习或准确率增长机制。
- 未来智能项目派分、AI 任务拆解或新的 Agent Harness。
- 尚未确认的部门路由、人员推荐和自动发布策略。

页面中已有的“AI研判助手”只按当前事实记录：后端可选返回 `item.aiAdvice`，当前查询并未提供该字段；没有字段时由前端展示规则辅助。原型中的 `86%`、`0.82` 等均为硬编码演示数据，不代表生产能力。

质量事件与现有任务系统的桥接属于已存在的架构事实，因此本基线只记录它的边界和入口，不在此设计未来派分体验。

## 信息可信度标记

- `REC-89`：来自 `../标准录音 89.txt` 的业务访谈。
- `REC-110`：来自 `../标准录音 110.txt` 的业务访谈。
- `SRC`：由当前源码直接确认。
- `PROTO`：只存在于 HTML 原型或演示数据。
- `DEC`：本轮文档确认的范围或设计决定。
- `GAP`：需求、源码与原型之间存在差异。
- `OPEN`：需要 Leader 或业务方确认。

引用录音时以仓库上一级目录 `标准录音 89.txt`、`标准录音 110.txt` 为准。

## 新会话最小阅读顺序

1. 必须先阅读本文件。
2. 处理需求、角色或流程问题时，继续阅读 [01-requirements-baseline.md](./01-requirements-baseline.md) 和 [02-workflow-and-roles.md](./02-workflow-and-roles.md)。
3. 修改页面、文案或交互时，继续阅读 [03-html-interaction-spec.md](./03-html-interaction-spec.md)。
4. 修改接口、查询、SQLite 或权限时，继续阅读 [04-api-data-source-map.md](./04-api-data-source-map.md)。
5. 做方案判断前，检查 [05-decisions-and-gaps.md](./05-decisions-and-gaps.md)，不要重新决定已确认事项。
6. 只打开上述文档指向的目标源码；若任务跨越多个模块，再扩大检查范围。
7. 文档与源码冲突时，以当前源码行为为准，同时更新本目录文档和 `last_verified_at`。

## 一句话业务模型

客户反馈从钉钉表格同步为只读来源快照，售后主管基于风险信号和原始事实作人工研判；只有“通报质量异常”才创建并提交质量事件，后续质量协作保留独立的质量数据、证据和审核关系，执行层通过确定性桥接连接现有正式任务能力。

## 当前页面

- `/workbench/quality/review`：反馈研判工作台，仅售后主管。
- `/workbench/quality`：质量追踪主工作台，售后主管和质量专员。
- `/workbench/quality/opinions`：私密质量意见，配置下级与对应质量专员双方。
- `docs/mockups/quality-tracking-interface-prototype.html`：综合交互原型，只用于评审，不是运行时页面。

## 当前实现状态快照

- 技术栈：TypeScript、Node.js、SQLite、服务端生成 HTML/CSS/原生浏览器 JavaScript。
- 来源运行时：配置完整时进程启动立即同步，之后默认每 2 小时同步一次；失败保留最近成功数据。
- 本地生产快照曾核对：`quality_source_rows=1603`，`quality_source_reviews=0`，`quality_events=0`，`quality_assignment_nodes=0`。
- 研判页面真实调用现有 HTTP API 和 SQLite，不是静态 HTML。
- 当前没有真实 AI 研判服务。
- 质量 review 页面相关 lint、typecheck 和 Vitest 曾通过；后续修改仍须重新验证。

## 核心不变量

- 来源快照只读；业务判断另存，不能覆盖原始来源事实。
- 售后主管对研判结果负责，规则或未来 AI 只能提供建议。
- `ORDINARY`、`NEEDS_INFO` 直接保存来源研判；`REPORTED` 只能在质量事件成功提交后产生。
- 已通报来源不能在研判页撤回为普通或待补资料。
- 质量事件关闭后只读；历史证据和公开审计不删除。
- 私密质量意见不进入公开审计、任务事件、证据包或通知正文。
- 执行状态仍以正式任务系统为权威，质量模块不应制造第二套执行状态。

## 维护要求

任何影响以下内容的改动都必须同步本目录：角色权限、状态迁移、来源字段、风险规则、页面操作、API 路径、数据库表或源码入口。只改样式且不改变交互语义时，可仅更新 `last_verified_at` 和相关截图说明。
