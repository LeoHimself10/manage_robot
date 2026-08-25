---
status: baseline
last_verified_at: 2026-08-25
verified_against: working-tree
scope: current-api-data-and-source-map
maintainer: EDY
---

# 质量追踪 API、数据与源码地图

## 1. 运行入口

- HTTP 集成入口：`src/web/quality-http.ts`。
- 页面壳和登录会话：`src/web/assignment-workbench.ts`、`src/web/workbench-shell.ts`。
- SQLite 路径解析：`src/infra/workbench-db-path.ts`。
- 本地现有库启动脚本：`scripts/local-existing-db-dev.ts`。
- 默认本地生产快照：`data/local-production-db/workbench.sqlite`。

所有质量页面和 API 都复用工作台会话。`external_password` 登录来源不能访问质量页面；角色和对象级可见性必须在服务端再次校验。

## 2. 页面权限入口

### `/workbench/quality`

方法：`GET`、`HEAD`。

权限：`resolveQualityCapabilities(userId).canAccessTracking`，即售后主管、具有 `quality_management` 能力的员工或 admin（admin 只读业务动作）。

渲染：`renderQualityTrackingPage`。

### `/workbench/quality/review`

方法：`GET`、`HEAD`。

权限：必须包含 `aftersales_manager`。

渲染：`renderQualityReviewPage`。

### `/workbench/quality/opinions`

方法：`GET`、`HEAD`。

权限：质量专员或已配置为质量意见人员的用户。

渲染：`renderQualityOpinionsPage`。

当 `QUALITY_TASK_PLANNING_V2_ENABLED=1` 时该入口及 API 返回 404，导航不再展示；旧实现仅保留为关闭开关后的回滚路径。

## 3. 反馈来源与研判 API

### `GET /api/workbench/quality/source`

用途：查询来源列表或同步状态，支持搜索、分页和已通报筛选。主要供质量主工作台使用；研判页也用它读取同步状态。

权限：质量追踪角色；具体分支以 `quality-http.ts` 为准。

### `POST /api/workbench/quality/source/sync`

用途：触发一次人工来源同步。服务端共享同一个进行中 Promise，避免并发重复同步。

副作用：更新来源行、来源版本、同步状态并刷新规则候选。

### `GET /api/workbench/quality/review-queue`

权限：仅售后主管。

参数：

- `scope`：`UNREVIEWED`、`NEEDS_INFO`、`COMPLETED`。
- `q`：关键词。
- `risk`：`ALL`、`HIGH_RISK`、`REPEAT`、`NONE`。
- `deviceModel`、`category`。
- `page`、`pageSize`，最大 `200`。

响应：`items`、`pagination`、`stats`、可用的型号和分类筛选项。当前查询只纳入反馈时间可解析且在最近六个月内的非删除来源。

实现：`src/quality/queries/quality-review-query.ts`。

### `POST /api/workbench/quality/source/{sourceKey}/review`

权限：仅售后主管。

请求核心字段：

- `decision`：`ORDINARY` 或 `NEEDS_INFO`。
- `note`：可选，最多 2000 字。
- `expectedVersion`：当前研判版本，无记录时为 0。
- `requestId`：幂等键。

行为：校验来源存在且未删除、未被通报、版本一致；事务内写 `quality_source_reviews`、审计和来源回写 outbox。

实现：`src/quality/reviews/quality-source-review-service.ts`。

### `POST /api/workbench/quality/source/{sourceKey}/writeback/retry`

权限：仅售后主管。

用途：将该来源最新的 `DEAD` 回写任务重新入队。没有失败终态任务时返回错误。

实现：`src/quality/source/quality-source-writeback.ts`、`quality-source-writeback-runtime.ts`。

## 4. 规则候选 API

### `GET /api/workbench/quality/candidates`

用途：分页查询异常候选，支持状态筛选。候选是规则信号，不是质量事件。

### `POST /api/workbench/quality/candidates/{candidateId}/dismiss`

用途：填写原因并忽略候选，使用版本校验。若关联来源内容变化，检测器可以重新打开此前忽略的候选。

关键实现：

- `src/quality/candidates/quality-candidate-detector.ts`
- `src/quality/candidates/quality-similarity.ts`
- `src/quality/queries/quality-event-query.ts`

## 5. 质量事件 API

### `POST /api/workbench/quality/events/drafts`

权限：售后主管。

用途：从 `sourceKeys` 创建来源关联草稿，或用 `draft` 创建手工草稿。请求携带 `requestId`。来源关联时保存不可变来源快照。

### `GET /api/workbench/quality/events`

用途：按当前用户对象级可见性列出事件。售后主管只看本人通报事件，质量专员看全部已提交事件，原主责/协同主管/执行人由责任树决定范围。

### `GET /api/workbench/quality/events/{eventId}`

用途：返回事件、来源快照、关系、责任节点、证据、审核、通知、审计和 `allowedActions`。敏感通知错误按角色脱敏。

实现：`src/quality/queries/quality-event-query.ts`。

### `PATCH /api/workbench/quality/events/{eventId}/draft`

权限：草稿创建者/售后主管规则由服务端校验。

用途：使用 `expectedVersion` 更新草稿字段。提交后不能用草稿覆盖正式记录。

### `POST /api/workbench/quality/events/{eventId}/submit`

权限：售后主管。

用途：提交草稿，状态 `DRAFT → PENDING_ASSIGNMENT`。同一事务中把关联来源研判为 `REPORTED`、写审计和来源回写 outbox。

### `POST /api/workbench/quality/events/{eventId}/supplements`

用途：提交后追加事实，不覆盖原始通报。

### `POST /api/workbench/quality/events/{eventId}/corrections`

用途：带原因更正正式字段，保存前后内容和审计。

### `POST /api/workbench/quality/events/{eventId}/files`

用途：上传事件级附件，页面约束单文件不超过 20MB；文件内容存文件目录，元数据存 SQLite。

### 质量专员事件动作

统一模式：`POST /api/workbench/quality/events/{eventId}/{action}`。

当前动作：

- `assign-primary`：指定原主责和总期限。
- `due`：调整总期限。
- `return-node`：终验退回指定节点。
- `close`：填写终验结论并关闭。
- `reopen`：带理由重开指定节点。

具体请求字段、版本、节点和状态校验由 `quality-http.ts`、事件/分配/审核/关闭服务共同负责。未来智能派分不在本基线设计。

### 统一任务分配 V2（开关启用时）

- `GET /api/workbench/quality/events/{eventId}/analysis`：读取不可覆盖的质量初析版本及任务分配关联状态。
- `POST /api/workbench/quality/events/{eventId}/analysis`：具有 `quality_management` 能力的员工保存初析草稿。
- `POST /api/workbench/quality/events/{eventId}/analysis/complete`：完成并冻结一个初析版本。
- `POST /api/workbench/quality/events/{eventId}/planning-session`：主管创建或恢复质量任务专用侧会话；会话预置来源只读快照和忠实映射草案。

V2 下 `assign-primary` 和 `due` 被服务端拒绝。人员、执行人和期限只在 `/workbench/manager/chat` 与正式任务页调整。发布成功后，`publish_task` 以同一个正式父任务和其子任务建立质量投影；桥接失败标记 `REPAIR_REQUIRED`，进程启动会补偿，不回滚已发布正式任务。

## 6. 当前质量责任链与正式任务桥接 API

这些 API 属于已有运行框架，记录是为了让维护者理解边界，不代表本文件设计新的派分功能。

### `GET /api/workbench/manager/quality-nodes`

用途：主管读取自己待处理或执行中的质量节点。

### `POST /api/workbench/manager/quality-nodes/{nodeId}/accept`

用途：原主责或主管节点接受。根节点接受后成为 `is_primary=1`，事件进入 `IN_PROGRESS`。

### `POST /api/workbench/manager/quality-nodes/{nodeId}/reject`

用途：根节点驳回，事件返回 `PENDING_ASSIGNMENT`；需要理由和版本校验。

### `POST /api/workbench/manager/quality-nodes/{nodeId}/delegate`

用途：当前主管节点手工创建一个子质量节点并桥接正式任务。目标可为主管或员工；只有主管子节点可继续向下分配，子期限不能晚于父期限。

### `POST /api/workbench/manager/quality-nodes/{nodeId}/children/{childId}/due`

用途：在策略允许范围内调整子节点期限。

关键实现：

- `src/quality/assignments/quality-assignment-service.ts`
- `src/quality/assignments/quality-assignment-policy.ts`
- `src/quality/assignments/quality-task-bridge.ts`
- `src/quality/assignments/quality-task-context.ts`
- `src/quality/assignments/quality-bridge-reconciler.ts`

## 7. 证据、验收和通知 API

### `POST /api/workbench/quality/nodes/{nodeId}/evidence`

用途：上传节点证据，生成不可覆盖的新证据版本。

### `POST /api/workbench/quality/nodes/{nodeId}/submit-completion`

用途：提交节点完成；叶子节点至少需要一份证据。

### `GET /api/workbench/quality/evidence/{evidenceId}`

用途：下载证据。必须按事件和责任树可见性进行服务端校验。

### `POST /api/workbench/quality/nodes/{nodeId}/review`

用途：直接上级通过或退回子节点。

### `POST /api/workbench/quality/events/{eventId}/primary-review`

用途：原主责整体验收或退回具体分支。

### `GET /api/workbench/quality/events/{eventId}/evidence-package`

用途：返回当前用户有权查看的证据包。

### `POST /api/workbench/quality/notifications/{notificationId}/retry`

权限：质量专员。

用途：将 `DEAD` 通知重新入队；业务事务本身不因通知失败而回滚。

关键实现：

- `src/quality/evidence/quality-evidence-service.ts`
- `src/quality/reviews/quality-review-service.ts`
- `src/quality/closure/quality-closure-service.ts`
- `src/quality/notifications/quality-notification-outbox.ts`
- `src/quality/notifications/quality-notification-policy.ts`
- `src/quality/notifications/quality-notification-scheduler.ts`

## 8. 私密质量意见 API

### `GET /api/workbench/quality/opinions/events`

权限：质量意见人员。按其对应质量专员返回可建立会话的事件。

### `GET /api/workbench/quality/opinions/threads`

权限：质量专员或质量意见人员，只返回本人作为会话一方的线程。

### `POST /api/workbench/quality/opinions/threads`

权限：质量意见人员。按事件和对应质量专员创建或取得线程。

### `GET|POST /api/workbench/quality/opinions/threads/{threadId}/messages`

权限：线程双方。关闭事件允许读取但禁止继续发送。

实现：`src/quality/comments/quality-private-comment-service.ts`。

## 9. SQLite 数据地图

### 来源层

- `quality_source_sync_state`：最近同步尝试、成功、错误和来源标识。
- `quality_source_rows`：当前来源状态、内容哈希、标准化 JSON、当前/上一版快照、版本和同步时间。
- `quality_source_reviews`：来源最终人工研判、备注、操作人、来源哈希、关联事件和版本。
- `quality_source_review_audit`：来源研判前后值、请求幂等键和操作人。
- `quality_source_writeback_outbox`：回写目标值、状态、重试次数、下次重试和安全错误摘要。
- `quality_candidates`：规则候选、规则码、关联来源、解释、人工忽略/通报状态和版本。

### 事件层

- `quality_events`：事件编号、状态、原始通报字段、紧急度、总期限、根节点和版本。
- `quality_event_source_links`：事件与不可变来源快照。
- `quality_event_relations`：相关事件或相关来源及关系快照。
- `quality_event_supplements`：提交后的补充记录。
- `quality_report_files`：事件级附件元数据。
- `quality_audit_events`：正式公开审计。

### 责任与执行层

- `quality_assignment_nodes`：责任树、承接人、类型、部门、期限、要求、状态和版本。
- `quality_task_links`：质量节点与正式 task/subtask 的确定性桥接。V2 允许多个节点共享同一 `task_id`，根节点 `subtask_id` 可空，执行节点的 `subtask_id` 仍唯一。
- `quality_analysis_versions`：质量初析版本；`COMPLETED` 版本不可覆盖。
- `quality_planning_sessions`：事件到专用侧会话、`plan_id`、来源哈希和发布桥接状态的幂等记录。
- `quality_evidence`：节点证据和版本。
- `quality_node_reviews`：逐级审核决定、理由和证据版本。

### 私密与通知层

- `quality_private_threads`：事件、质量专员、质量意见人员和关闭状态。
- `quality_private_messages`：私密正文、发送人和时间。
- `quality_notification_outbox`：业务通知、状态、退避重试、错误和人工恢复。

## 10. 关键源码地图

### 来源连接

- `src/quality/source/dingtalk-quality-source.ts`：钉钉工作簿读取。
- `src/quality/source/quality-source-schema.ts`：表头别名、标准化和来源键。
- `src/quality/source/quality-source-sync.ts`：差量同步、状态和快照。
- `src/quality/source/quality-source-runtime.ts`：配置完整性和运行时启动。
- `src/quality/source/quality-source-scheduler.ts`：启动即同步和两小时循环。
- `src/quality/source/quality-source-writeback*.ts`：人工研判结果回写。

### 领域与持久化

- `src/quality/domain/quality-types.ts`：事件、节点、证据和审计类型。
- `src/quality/domain/quality-state-machine.ts`：事件合法状态迁移和退回影响。
- `src/quality/infra/quality-store.ts`：SQLite 建表、迁移和写存储。
- `src/quality/infra/quality-read-store.ts`：只读查询存储。

### 业务服务

- `src/quality/events/quality-event-service.ts`：事件草稿、提交、补充、更正、来源关系。
- `src/quality/reviews/quality-source-review-service.ts`：来源人工研判和回写 outbox。
- `src/quality/reviews/quality-review-service.ts`：节点与原主责审核。
- `src/quality/closure/quality-closure-service.ts`：终验、关闭和重开。
- `src/quality/comments/quality-private-comment-service.ts`：私密意见。

### 查询与页面

- `src/quality/queries/quality-review-query.ts`：研判队列、筛选、统计和风险信号拼装。
- `src/quality/queries/quality-event-query.ts`：对象级可见性、事件详情和允许动作。
- `src/security/quality-capabilities.ts`：质量业务角色解析。
- `src/web/quality-http.ts`：页面/API路由、请求校验和权限入口。
- `src/web/quality-review-page.ts`：反馈研判 HTML 和交互。
- `src/web/quality-tracking-page.ts`：质量主工作台 HTML 和交互。
- `src/web/quality-opinions-page.ts`：私密意见 HTML 和交互。

## 11. 测试入口

- `tests/security/quality-capabilities.test.ts`：角色与质量权限。
- `tests/quality/quality-source-review-service.test.ts`：人工研判、并发、审计和回写。
- `tests/quality/quality-source-writeback.test.ts`：回写状态和重试。
- `tests/quality/quality-read-store.test.ts`：对象级读取。
- `tests/quality/`：事件、分配、证据、审核、关闭、通知和评论服务。
- `tests/web/quality-review-page.test.ts`：研判页面结构和关键交互文本。
- `tests/web/quality-review-http.test.ts`：研判页面/API权限和HTTP行为。
- `tests/web/quality-tracking-page.test.ts`：质量主页面结构。
- 其他 `tests/web/quality-*.test.ts`：质量 HTTP 与页面集成。

建议验证顺序：目标测试 → 全部质量测试 → `npm run typecheck` → `npm run lint:inline-pages`。Vitest 环境默认禁止真实网络来源同步。

## 12. 修改导航

- 改来源字段：先看 schema、sync 和来源测试。
- 改研判筛选/状态：先看 review query、review service、review HTTP 和 review page。
- 改事件流程：先看 state machine、event service、event query 和事件测试。
- 改权限：先看 capabilities、event query 对象可见性、下载权限和 HTTP。
- 改 HTML：先看 [03-html-interaction-spec.md](./03-html-interaction-spec.md)，再改页面和对应测试。
- 改未来 AI 或智能派分：不要写入本基线；另建架构文档并明确与当前接口的连接点。
