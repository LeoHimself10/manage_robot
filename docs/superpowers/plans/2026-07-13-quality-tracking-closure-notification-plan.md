# 质量追踪第三阶段：全链路闭环、私密评论与可靠通知实施计划

> **执行要求：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施；每一步使用复选框跟踪。

**目标：** 为质量专员提供完整事件列表、递归分配树、证据和审计视图，支持指定节点退回、最终关闭和有理由重开；为质量专员下级提供严格双方可见的私密评论；用持久化 outbox 可靠发送质量通知。

**架构：** 质量事件状态由业务动作和分配树投影；质量专员页面只调用质量领域服务；私密评论单独建表并在查询层做三方关系校验；通知业务事务只写 outbox，后台调度器复用现有钉钉卡片和机器人通道发送并重试。

**技术栈：** Node.js 22、TypeScript、`node:sqlite`、Vitest、现有工作台服务端 HTML/原生 JavaScript、现有钉钉通知客户端、进程内 scheduler。

## 全局约束

- [ ] 必须在第二阶段验收完成后开始。
- [ ] 质量专员可看全链路，但普通节点提交/退回不逐条推送给质量专员。
- [ ] 质量专员指定节点退回只重开该节点及受影响的上游验收，不删除其他分支历史。
- [ ] 已关闭事件只有质量专员可重开，原因必填。
- [ ] 私密评论只能由关系文件中的评论人和对应质量专员读取；管理员业务页也不得读取。
- [ ] 私密评论不进入公开审计正文、任务事件、证据包或通知详情。
- [ ] 通知失败不回滚业务动作；同一动作和收件人不得重复轰炸。
- [ ] 发布前必须做完整权限矩阵、状态迁移、移动端、故障和现有工作台回归。

---

### 任务 1：固化完整状态投影和指定节点退回算法（FR-QT-FSM-01）

**文件：**

- 修改：`src/quality/reviews/quality-event-projector.ts`
- 新增：`src/quality/domain/quality-state-machine.ts`
- 新增：`tests/quality/quality-state-machine.test.ts`

- [ ] **步骤 1：先写完整迁移表测试**

```ts
it.each([
  ["DRAFT", "SUBMIT", "PENDING_ASSIGNMENT"],
  ["PENDING_ASSIGNMENT", "ASSIGN_PRIMARY", "PENDING_ACCEPTANCE"],
  ["PENDING_ACCEPTANCE", "ACCEPT_PRIMARY", "IN_PROGRESS"],
  ["IN_PROGRESS", "ALL_BRANCHES_APPROVED", "PENDING_PRIMARY_REVIEW"],
  ["PENDING_PRIMARY_REVIEW", "PRIMARY_APPROVE", "PENDING_QUALITY_REVIEW"],
  ["PENDING_QUALITY_REVIEW", "QUALITY_CLOSE", "CLOSED"],
])("%s 经 %s 进入 %s", (from, action, to) => {
  expect(transitionQualityEvent(from, action)).toBe(to);
});
```

同时测试非法迁移、根主管驳回回待分配、直接上级退回保持处理中、质量指定节点退回、关闭后重开。

- [ ] **步骤 2：实现动作驱动状态机**

```ts
export type QualityEventAction =
  | "SUBMIT"
  | "ASSIGN_PRIMARY"
  | "REJECT_PRIMARY"
  | "ACCEPT_PRIMARY"
  | "NODE_RETURN"
  | "ALL_BRANCHES_APPROVED"
  | "PRIMARY_RETURN"
  | "PRIMARY_APPROVE"
  | "QUALITY_RETURN_NODE"
  | "QUALITY_CLOSE"
  | "QUALITY_REOPEN";
```

客户端不得传目标状态；任何 store 更新状态的方法改为包内私有，只允许领域服务调用迁移函数。

- [ ] **步骤 3：实现受影响上游集合**

指定节点退回时：目标节点置 `RETURNED`；从目标父节点沿祖先向根，把已有 `APPROVED` 或待验收状态改回 `IN_PROGRESS`；目标的无关兄弟和后代历史保持不变；事件进入 `IN_PROGRESS`。算法返回 `affectedNodeIds` 写入审计和通知。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/quality/quality-state-machine.test.ts tests/quality/quality-review-service.test.ts
git add src/quality/domain/quality-state-machine.ts src/quality/reviews/quality-event-projector.ts tests/quality/quality-state-machine.test.ts
git commit -m "feat: enforce quality event state machine"
```

### 任务 2：实现质量专员终验、关闭与重开服务（FR-QT-CLOSE-01）

**文件：**

- 新增：`src/quality/closure/quality-closure-service.ts`
- 新增：`tests/quality/quality-closure-service.test.ts`

- [ ] **步骤 1：先写权限和前置条件测试**

覆盖：非质量专员 403；只有 `PENDING_QUALITY_REVIEW` 可关闭；关闭前每个有效叶子节点有证据且全链验收通过；指定节点退回必须给原因；关闭后只读；重开必须给原因并选择重开节点或根节点；重开保留关闭审计和证据。

- [ ] **步骤 2：实现动作接口**

```ts
returnSpecificNode(input: {
  eventId: string;
  nodeId: string;
  specialistUserId: string;
  reason: string;
  expectedVersion: number;
  requestId: string;
}): Promise<{ event: QualityEvent; affectedNodeIds: string[] }>;

closeEvent(input: {
  eventId: string;
  specialistUserId: string;
  conclusion: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityEvent>;

reopenEvent(input: {
  eventId: string;
  nodeId: string;
  specialistUserId: string;
  reason: string;
  expectedVersion: number;
  requestId: string;
}): Promise<{ event: QualityEvent; affectedNodeIds: string[] }>;
```

- [ ] **步骤 3：测试并提交**

```bash
npx vitest run tests/quality/quality-closure-service.test.ts
git add src/quality/closure tests/quality/quality-closure-service.test.ts
git commit -m "feat: add quality final review and reopen"
```

### 任务 3：实现质量专员全链路查询模型（FR-QT-VIEW-01）

**文件：**

- 新增：`src/quality/queries/quality-event-query.ts`
- 新增：`tests/quality/quality-event-query.test.ts`

- [ ] **步骤 1：先写角色范围测试**

质量专员可读全部公开事件；售后主管只读自己通报事件的公开链；普通主管只读分给自己的分支；原主责读整棵树；执行人只读自己节点；草稿只对创建人；任何公开查询都不返回私密评论。

- [ ] **步骤 2：实现稳定 DTO**

```ts
export interface QualityEventDetailView {
  event: QualityEventPublicView;
  sourceSnapshots: QualitySourceSnapshotView[];
  relatedEvents: QualityRelatedEventView[];
  assignmentTree: QualityAssignmentNodeView[];
  evidence: QualityEvidenceView[];
  reviews: QualityReviewView[];
  publicAudit: QualityAuditView[];
  notifications: QualityNotificationView[];
  allowedActions: string[];
}
```

查询按批量 SQL 装配，不在树节点循环内重复访问数据库。`publicAudit` 对补充和更正显示业务文本，对系统错误、密钥和私密内容只显示安全摘要。

- [ ] **步骤 3：测试并提交**

```bash
npx vitest run tests/quality/quality-event-query.test.ts
git add src/quality/queries tests/quality/quality-event-query.test.ts
git commit -m "feat: build role scoped quality event view"
```

### 任务 4：完成质量专员事件列表与全链路详情页（FR-QT-UI-05）

**文件：**

- 修改：`src/web/quality-tracking-page.ts`
- 修改：`src/web/quality-tracking-styles.ts`
- 修改：`src/web/quality-http.ts`
- 新增：`tests/web/quality-specialist-page.test.ts`
- 新增：`tests/web/quality-closure-api.test.ts`

- [ ] **步骤 1：先写列表和动作测试**

断言列表分组为待分配、待承接、处理中、待原主责确认、待终验、已关闭；详情包含原始通报、来源快照、相关事件、原主责、总期限、完整分配树、证据、验收、通知和公开审计；按钮由 `allowedActions` 决定。

- [ ] **步骤 2：增加端点**

```text
POST /api/workbench/quality/events/:id/assign-primary
POST /api/workbench/quality/events/:id/due
POST /api/workbench/quality/events/:id/return-node
POST /api/workbench/quality/events/:id/close
POST /api/workbench/quality/events/:id/reopen
```

所有写端点要求 `expectedVersion`、UUID `requestId`；冲突返回 409 和最新版本号，不自动覆盖。

- [ ] **步骤 3：实现递归树和证据包交互**

树节点显示部门、承接人、父节点、期限、状态、正式任务编号、证据数量和最近验收；展开后显示证据版本和验收历史。指定节点退回从树节点操作，确认框明确列出受影响上游。

- [ ] **步骤 4：实现关闭与重开交互**

关闭必须填写结论；重开必须填写原因并选择节点。售后主管在自己事件详情只看到结果和补充/更正入口，不出现验收、关闭或重开按钮。

- [ ] **步骤 5：测试并提交**

```bash
npx vitest run tests/web/quality-specialist-page.test.ts tests/web/quality-closure-api.test.ts
git add src/web/quality-tracking-page.ts src/web/quality-tracking-styles.ts src/web/quality-http.ts tests/web/quality-specialist-page.test.ts tests/web/quality-closure-api.test.ts
git commit -m "feat: build quality specialist full chain page"
```

### 任务 5：建立严格双方可见的私密评论数据与服务（FR-QT-COM-01）

**文件：**

- 修改：`src/quality/infra/quality-store.ts`
- 新增：`src/quality/comments/quality-private-comment-service.ts`
- 新增：`tests/quality/quality-private-comment-service.test.ts`

- [ ] **步骤 1：先写隐私测试**

测试：配置下级可就进行中事件开对话；对应质量专员可回复；第三名下级、售后、主管、执行人和 admin 均不能读取；下级不能选择其他质量专员；关闭事件只读；评论不出现在公开事件查询、`task_events` 或证据包。

- [ ] **步骤 2：新增表和唯一关系**

```sql
quality_private_threads
quality_private_messages
```

线程唯一键为 `(event_id, specialist_user_id, report_user_id)`。消息含 `message_id`、`thread_id`、`sender_user_id`、`body`、`request_id`、`created_at`；`UNIQUE(thread_id, request_id)` 保证重试幂等。

- [ ] **步骤 3：实现三项关系校验**

每次读取和写入同时校验：事件存在且非草稿；评论人仍在该质量专员关系文件中；当前 viewer 等于线程的 specialist 或 report。服务返回通用 403，不泄露线程是否存在。

- [ ] **步骤 4：日志脱敏和测试**

结构化日志只记录 messageId、threadId、双方掩码和长度，不记录正文。

```bash
npx vitest run tests/quality/quality-private-comment-service.test.ts
git add src/quality/infra/quality-store.ts src/quality/comments tests/quality/quality-private-comment-service.test.ts
git commit -m "feat: add two party private quality comments"
```

### 任务 6：实现受限“质量意见”页面和质量专员私密会话区（FR-QT-UI-06）

**文件：**

- 新增：`src/web/quality-opinions-page.ts`
- 修改：`src/web/quality-tracking-page.ts`
- 修改：`src/web/quality-http.ts`
- 新增：`tests/web/quality-opinions-page.test.ts`
- 新增：`tests/web/quality-private-comments-api.test.ts`

- [ ] **步骤 1：先写页面权限测试**

质量专员下级只看到进行中事件必要信息、公开状态和自己的对话；看不到分配树、期限修改、证据验收、关闭、其他下级名称或对话。质量专员按评论人分组查看；不同下级之间的数据响应互不包含。

- [ ] **步骤 2：增加端点**

```text
GET  /workbench/quality/opinions
GET  /api/workbench/quality/opinions/events
GET  /api/workbench/quality/opinions/threads
POST /api/workbench/quality/opinions/threads
GET  /api/workbench/quality/opinions/threads/:id/messages
POST /api/workbench/quality/opinions/threads/:id/messages
```

- [ ] **步骤 3：实现页面交互**

评论正文最大 5000 字；发送按钮防重复点击并携带 requestId；界面明确写“仅您和质量专员可见，不进入正式验收链路”。关闭事件保留历史对话但禁用输入。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/web/quality-opinions-page.test.ts tests/web/quality-private-comments-api.test.ts
git add src/web/quality-opinions-page.ts src/web/quality-tracking-page.ts src/web/quality-http.ts tests/web/quality-opinions-page.test.ts tests/web/quality-private-comments-api.test.ts
git commit -m "feat: add restricted quality opinions page"
```

### 任务 7：建立持久化通知 outbox 和通用质量通知通道（FR-QT-NOTIFY-01）

**文件：**

- 修改：`src/quality/infra/quality-store.ts`
- 新增：`src/quality/notifications/quality-notification-outbox.ts`
- 修改：`src/integrations/dingtalk/workbench-notify.ts`
- 新增：`tests/quality/quality-notification-outbox.test.ts`
- 新增：`tests/integrations/dingtalk/quality-notify.test.ts`

- [ ] **步骤 1：先写事务、去重和重试测试**

业务事务成功时 outbox 同事务写入；发送失败不改业务状态；相同 `dedupe_key` 只一条；成功不再发送；失败按 1 分钟、5 分钟、15 分钟、1 小时、6 小时退避，最多 8 次；第 8 次失败进入 `DEAD`。

- [ ] **步骤 2：新增 outbox 表**

```sql
quality_notification_outbox
```

字段包含 `notification_id`、`event_id`、`action`、`recipient_user_id`、`channel`、`subject`、`markdown`、`detail_url`、`dedupe_key`、`status`、`attempt_count`、`next_attempt_at`、`last_error`、`created_at`、`sent_at`，并对 `dedupe_key` 唯一。

- [ ] **步骤 3：为现有 notifier 增加通用方法**

```ts
notifyQualityAction(input: {
  recipientUserId: string;
  subject: string;
  markdown: string;
  detailUrl: string;
}): Promise<WorkbenchNotifyResult>;
```

复用工作通知卡片和机器人 1:1；外部联系人跳过；方法不读取私密线程或数据库，只发送传入的安全摘要。

- [ ] **步骤 4：实现 worker 原子领取**

领取把 `PENDING/RETRY` 原子更新为 `SENDING` 并增加 attempt；进程崩溃超过 10 分钟的 `SENDING` 可回收为 `RETRY`。错误摘要裁剪到 500 字，不存 token 或响应正文。

- [ ] **步骤 5：测试并提交**

```bash
npx vitest run tests/quality/quality-notification-outbox.test.ts tests/integrations/dingtalk/quality-notify.test.ts
git add src/quality/infra/quality-store.ts src/quality/notifications src/integrations/dingtalk/workbench-notify.ts tests/quality/quality-notification-outbox.test.ts tests/integrations/dingtalk/quality-notify.test.ts
git commit -m "feat: add reliable quality notification outbox"
```

### 任务 8：按确认矩阵接入通知和附加逾期提醒（FR-QT-NOTIFY-02）

**文件：**

- 新增：`src/quality/notifications/quality-notification-policy.ts`
- 新增：`src/quality/notifications/quality-notification-scheduler.ts`
- 修改：`src/quality/events/quality-event-service.ts`
- 修改：`src/quality/assignments/quality-assignment-service.ts`
- 修改：`src/quality/reviews/quality-review-service.ts`
- 修改：`src/quality/closure/quality-closure-service.ts`
- 修改：`src/quality/comments/quality-private-comment-service.ts`
- 修改：`src/dingtalk-bot.ts`
- 新增：`tests/quality/quality-notification-policy.test.ts`
- 新增：`tests/quality/quality-notification-scheduler.test.ts`

- [ ] **步骤 1：先写逐动作收件人矩阵测试**

```ts
expect(recipientsFor("EVENT_SUBMITTED", ctx)).toEqual([qualitySpecialist]);
expect(recipientsFor("PRIMARY_ASSIGNED", ctx)).toEqual([primaryManager]);
expect(recipientsFor("NODE_DELEGATED", ctx)).toEqual([directAssignee]);
expect(recipientsFor("NODE_REJECTED", ctx)).toEqual([directParent, primaryManager, qualitySpecialist]);
expect(recipientsFor("NODE_EVIDENCE_SUBMITTED", ctx)).toEqual([directParent]);
expect(recipientsFor("NODE_RETURNED", ctx)).toEqual([returnedAssignee]);
expect(recipientsFor("PRIMARY_APPROVED", ctx)).toEqual([qualitySpecialist]);
expect(recipientsFor("QUALITY_CLOSED", ctx)).toEqual([aftersalesManager, primaryManager]);
expect(recipientsFor("QUALITY_RETURNED", ctx)).toEqual([aftersalesManager, primaryManager, returnedAssignee]);
expect(recipientsFor("PRIVATE_COMMENT", ctx)).toEqual([otherParty]);
```

阻塞或逾期通知直接上级、原主责、质量专员；普通证据提交/退回只通知节点双方，质量专员仅页面可见。

- [ ] **步骤 2：在各业务事务中只入队**

每个动作生成 `dedupe_key = sha256(eventId + actionId + recipientUserId + reminderCycle)`；不在 HTTP 请求事务内直接调用钉钉网络。

- [ ] **步骤 3：复用现有 T-1，补齐质量链收件人**

现有正式子任务 scheduler 继续负责给直接承接人 T-1 和给直接上级逾期提醒。质量 scheduler 扫描关联节点，只补原主责和质量专员的逾期通知，并用周期去重；不得再次给直接承接人发送同一 T-1。

- [ ] **步骤 4：启动 outbox 调度器**

```ts
const qualityNotificationScheduler = createQualityNotificationScheduler();
qualityNotificationScheduler.startIntervalLoop();
```

默认每 30 秒扫一次，单批 50 条；测试环境关闭后台循环。

- [ ] **步骤 5：测试并提交**

```bash
npx vitest run tests/quality/quality-notification-policy.test.ts tests/quality/quality-notification-scheduler.test.ts tests/agent/reminders
git add src/quality/notifications src/quality/events/quality-event-service.ts src/quality/assignments/quality-assignment-service.ts src/quality/reviews/quality-review-service.ts src/quality/closure/quality-closure-service.ts src/quality/comments/quality-private-comment-service.ts src/dingtalk-bot.ts tests/quality/quality-notification-policy.test.ts tests/quality/quality-notification-scheduler.test.ts
git commit -m "feat: send quality workflow notifications"
```

### 任务 9：在质量详情展示通知、公开审计和人工处理状态（FR-QT-OBS-01）

**文件：**

- 修改：`src/quality/queries/quality-event-query.ts`
- 修改：`src/web/quality-tracking-page.ts`
- 修改：`src/web/quality-http.ts`
- 新增：`tests/web/quality-audit-notification-view.test.ts`

- [ ] **步骤 1：先写可见性测试**

质量专员看到所有公开审计和通知状态；售后主管只看到自己事件的业务审计和发送状态摘要；普通主管只看到自己分支动作；任何页面不显示 token、物理文件路径、完整失败响应或私密评论正文。

- [ ] **步骤 2：实现通知状态区**

显示待发送、重试中、已发送、人工处理四种状态；`DEAD` 显示收件人、动作、安全错误摘要、尝试次数和最后时间。第一期只提供“重新入队”动作，不提供编辑通知正文或删除审计。

- [ ] **步骤 3：增加人工重试端点**

```text
POST /api/workbench/quality/notifications/:id/retry
```

仅质量专员可用；把 `DEAD` 改为 `RETRY`、attempt 保留并写审计，requestId 幂等。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/web/quality-audit-notification-view.test.ts
git add src/quality/queries/quality-event-query.ts src/web/quality-tracking-page.ts src/web/quality-http.ts tests/web/quality-audit-notification-view.test.ts
git commit -m "feat: expose quality audit and notification status"
```

### 任务 10：执行安全、并发、移动端和全量发布回归（FR-QT-REG-03）

**文件：**

- 新增：`tests/quality/quality-permission-matrix.test.ts`
- 新增：`tests/quality/quality-concurrency.test.ts`
- 新增：`tests/web/quality-mobile-render.test.ts`
- 修改：`AGENTS.md`
- 修改：`docs/deploy-aliyun-dingtalk.md`

- [ ] **步骤 1：建立完整权限矩阵**

对售后主管、质量专员、质量专员下级、原主责、协同主管、执行人、普通员工、admin 和外部账号逐个测试所有 GET/POST 路由；403 响应不包含目标对象标题、人员、线程或是否存在的信息。

- [ ] **步骤 2：建立并发和幂等测试**

并发更新同一事件只有一个版本成功；相同 requestId 返回原结果；不同 requestId 的旧版本返回 409；重复通知、重复桥接、重复来源链接都只保留一条。

- [ ] **步骤 3：建立故障测试**

覆盖钉钉读取 403/429/500、缓存回退、附件磁盘失败、数据库忙、通知超时、worker 重启回收、正式任务存在但桥接缺失；失败不能破坏既有任务或丢失审计。

- [ ] **步骤 4：检查桌面与 320px 页面**

质量追踪、主管任务质量区、员工质量任务和质量意见页在 320px、768px、1440px 下无页面级横向滚动；键盘可操作弹窗；焦点关闭后回到触发按钮；错误提示具有 `role=alert` 或 `aria-live`。

- [ ] **步骤 5：运行质量模块全套**

```bash
npx vitest run tests/quality tests/web/quality-*.test.ts tests/web/manager-quality-*.test.ts tests/web/employee-quality-*.test.ts tests/security/quality-capabilities.test.ts tests/integrations/dingtalk/quality-notify.test.ts
```

- [ ] **步骤 6：运行现有关键回归**

```bash
npx vitest run tests/infra/workbench-formal-task-store.test.ts tests/web/assignment-workbench.test.ts tests/web/task-detail-page.test.ts tests/agent/reminders tests/integrations/dingtalk
```

- [ ] **步骤 7：运行最终发布门槛**

```bash
npm run typecheck
npm test
git diff --check
rg -n "TODO|TBD|PLACEHOLDER|it\.skip|describe\.skip" src/quality tests/quality tests/web/quality-* tests/web/manager-quality-* tests/web/employee-quality-*
```

预期：前三个命令退出 `0`；最后一个无输出；没有真实钉钉网络调用发生在测试中。

- [ ] **步骤 8：更新部署与运行文档并提交**

文档写明角色配置、表格读权限、首表探针、两小时同步、文件目录持久卷、outbox 调度、双实例隔离、数据备份、失败人工处理和回滚步骤。

```bash
git add tests/quality/quality-permission-matrix.test.ts tests/quality/quality-concurrency.test.ts tests/web/quality-mobile-render.test.ts AGENTS.md docs/deploy-aliyun-dingtalk.md
git commit -m "test: complete quality tracking release gate"
```

## 第三阶段与最终验收清单

- [ ] 质量专员能按状态查看全部事件和公开全链路。
- [ ] 质量专员能变更总期限、指定具体节点退回、最终关闭和有理由重开。
- [ ] 指定节点退回只影响目标及其上游验收，历史证据和其他分支不丢失。
- [ ] 售后主管看到自己通报事件的公开链路和结果，但不能验收或关闭。
- [ ] 质量专员下级与质量专员可以双向评论，且严格只有双方可见。
- [ ] 私密评论不进入公开链、证据、状态或管理员业务页。
- [ ] 通知矩阵准确，失败不回滚，持久化重试和人工处理可见。
- [ ] 两小时来源同步、现有任务提醒和质量附加提醒不重复发送。
- [ ] 所有角色伪造请求、并发旧版本、循环分配、越级改期和越权下载均被拒绝。
- [ ] 现有任务发布、主管页面、员工承接、进度、催办、日报、绩效和其他工作台功能通过完整回归。
- [ ] `npm run typecheck`、`npm test`、`git diff --check` 全部通过。
