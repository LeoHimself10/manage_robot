# 质量追踪第二阶段：任务桥接、递归分配与证据验收实施计划

> **执行要求：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施；每一步使用复选框跟踪。

**目标：** 质量专员把已提交事件分配给原主责主管；承接主管在现有主管任务页查看、承接/驳回、分给下属或其他部门主管、设置直接子期限；各节点上传证据、逐级验收，原主责汇总后提交质量专员。

**架构：** 质量分配树和验收记录保存在独立 `quality_*` 表；每条质量分配边通过确定性集成键创建一个现有正式任务/子任务，并写 `quality_task_links`；正式子任务继续作为承接人、执行状态和截止时间权威源。

**技术栈：** Node.js 22、TypeScript、`node:sqlite`、Vitest、现有工作台正式任务仓储、现有 manager/employee 页面、Busboy multipart。

## 全局约束

- [ ] 必须在第一阶段验收完成后开始。
- [ ] 不在 `tasks`、`subtasks` 增加质量字段，不改变普通任务的状态语义。
- [ ] 质量桥接创建使用确定性集成键，重试不得产生重复正式任务。
- [ ] 主管只能操作自己承接的节点和直接子节点；质量专员不能代替直接上级做常规验收。
- [ ] 原主责身份一经首次有效承接保持不变，驳回重分配保留历史节点。
- [ ] 没有子节点、需要直接执行的质量节点完成前至少有一份已落盘且摘要校验成功的证据；已有下级分支的主管节点以全部直接子节点通过后的证据汇总为完成依据，不强迫重复上传同一证据。
- [ ] 节点退回只追加新证据版本，不删除旧证据。
- [ ] 现有普通任务接口命中非质量子任务时行为必须逐字节兼容原响应结构。

---

### 任务 1：为正式任务仓储增加幂等集成创建接口（FR-QT-BRIDGE-01）

**文件：**

- 修改：`src/infra/workbench-formal-task-store.ts`
- 修改：`tests/infra/workbench-formal-task-store.test.ts`

- [ ] **步骤 1：先写失败测试**

```ts
it("相同 integrationKey 只创建一个正式任务和一个子任务", () => {
  const first = store.createIntegrationTask(input);
  const second = store.createIntegrationTask(input);
  expect(second.alreadyCreated).toBe(true);
  expect(second.task.taskId).toBe(first.task.taskId);
  expect(store.getTaskDetail(first.task.taskId)?.subtasks).toHaveLength(1);
});
```

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/infra/workbench-formal-task-store.test.ts -t "integrationKey"
```

- [ ] **步骤 3：实现通用集成端口**

```ts
createIntegrationTask(input: {
  integrationKey: string;
  title: string;
  description: string;
  initiatorUserId: string;
  initiatorDepartment: string;
  managerUserId: string;
  assigneeUserId: string;
  dueAt: string;
  sourceTraceId: string;
}): {
  task: WorkbenchTaskRow;
  subtask: WorkbenchSubtaskRow;
  alreadyCreated: boolean;
};
```

内部 `planId` 固定为 `integration:${integrationKey}`，`taskId` 固定为 `task:integration:${integrationKey}`，`source_task_key` 固定为 `work`。若 `planId` 已存在，校验 manager、assignee、标题一致后返回原记录；不一致则抛出 `integration task conflict`，禁止静默覆盖。

- [ ] **步骤 4：确认普通发布不变并提交**

```bash
npx vitest run tests/infra/workbench-formal-task-store.test.ts
git add src/infra/workbench-formal-task-store.ts tests/infra/workbench-formal-task-store.test.ts
git commit -m "feat: add idempotent integration task port"
```

### 任务 2：增加分配树、桥接和验收数据表（FR-QT-DATA-02）

**文件：**

- 修改：`src/quality/domain/quality-types.ts`
- 修改：`src/quality/infra/quality-store.ts`
- 新增：`tests/quality/quality-assignment-store.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖根节点唯一、父子关系、桥接唯一、祖先查询、直接子节点查询、验收追加、原主责不可替换、版本冲突。

- [ ] **步骤 2：确认第一阶段完整事件状态并新增节点状态**

```ts
export type QualityNodeStatus =
  | "PENDING_ACCEPTANCE"
  | "IN_PROGRESS"
  | "PENDING_PARENT_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "RETURNED"
  | "CANCELLED";
```

`QualityEventStatus` 和数据库 `CHECK` 已在第一阶段按七个完整状态声明，本阶段不得重建 `quality_events` 或缩窄枚举。

- [ ] **步骤 3：创建第二阶段表**

```sql
quality_assignment_nodes
quality_task_links
quality_evidence
quality_node_reviews
```

`quality_assignment_nodes` 至少包含 `node_id`、`event_id`、`parent_node_id`、`depth`、`assignee_user_id`、`assignee_kind`、`department_name`、`is_primary`、`status`、`due_at`、`version`、`created_by`、`accepted_at`、`submitted_at`、`updated_at`。`quality_task_links` 对 `node_id`、`task_id`、`subtask_id` 分别唯一。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/quality/quality-assignment-store.test.ts
git add src/quality/domain/quality-types.ts src/quality/infra/quality-store.ts tests/quality/quality-assignment-store.test.ts
git commit -m "feat: add quality assignment and review schema"
```

### 任务 3：实现原主责分配、总期限和正式任务桥接（FR-QT-ASG-01）

**文件：**

- 新增：`src/quality/assignments/quality-task-bridge.ts`
- 新增：`src/quality/assignments/quality-assignment-service.ts`
- 新增：`tests/quality/quality-primary-assignment.test.ts`

- [ ] **步骤 1：先写动作测试**

覆盖：只有质量专员能分配；必须选择主管名单中的人员；总期限必填；成功后事件进入 `PENDING_ACCEPTANCE`；正式任务 manager 为质量专员、assignee 为原主责；重复 requestId 返回同一节点和正式任务；首次承接后记录 immutable `primary_node_id`。

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/quality/quality-primary-assignment.test.ts
```

- [ ] **步骤 3：实现服务端动作**

```ts
assignPrimary(input: {
  eventId: string;
  specialistUserId: string;
  primaryManagerUserId: string;
  dueAt: string;
  taskRequirement: string;
  expectedVersion: number;
  requestId: string;
}): Promise<{ event: QualityEvent; node: QualityAssignmentNode }>;

changeEventDueAt(input: {
  eventId: string;
  specialistUserId: string;
  dueAt: string;
  reason: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityEvent>;
```

根节点集成键固定为 `quality-node:${nodeId}`。先幂等创建正式任务，再在质量事务中写节点与桥接；若质量事务失败，重试复用原正式任务。事件总期限变更同步调用正式仓储 `setSubtaskDueAt`，成功后再写质量审计；任一失败都保持可重试，不制造第二任务。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/quality/quality-primary-assignment.test.ts
git add src/quality/assignments tests/quality/quality-primary-assignment.test.ts
git commit -m "feat: assign primary quality owner through task bridge"
```

### 任务 4：实现主管承接、驳回和递归跨部门分配（FR-QT-ASG-02）

**文件：**

- 修改：`src/quality/assignments/quality-assignment-service.ts`
- 新增：`src/quality/assignments/quality-assignment-policy.ts`
- 新增：`tests/quality/quality-recursive-assignment.test.ts`

- [ ] **步骤 1：先写权限、循环和期限失败测试**

测试：本人才能承接/驳回；根节点驳回后事件回 `PENDING_ASSIGNMENT` 且历史节点保留；承接主管可分自己下属或其他主管；普通执行人不能再分配；不能把任务分给任一祖先；子期限不能晚于父期限；不能修改非直接子节点期限。

- [ ] **步骤 2：实现动作接口**

```ts
acceptNode(input: QualityNodeActionInput): Promise<QualityAssignmentNode>;
rejectNode(input: QualityNodeActionInput & { reason: string }): Promise<QualityAssignmentNode>;
delegateNode(input: {
  parentNodeId: string;
  actorUserId: string;
  assigneeUserId: string;
  assigneeKind: "MANAGER" | "EMPLOYEE";
  departmentName: string;
  dueAt: string;
  requirement: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityAssignmentNode>;
changeDirectChildDueAt(input: {
  childNodeId: string;
  actorUserId: string;
  dueAt: string;
  reason: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityAssignmentNode>;
```

- [ ] **步骤 3：实现循环和人员校验**

循环校验从当前父节点沿 `parent_node_id` 向上查 userId 集合，候选 assignee 命中即拒绝。`MANAGER` 必须在 `listWorkbenchManagerIds()` 中；`EMPLOYEE` 必须是活动通讯录人员且不是外部密码账号。跨部门主管不要求属于当前主管部门。

只有状态为 `IN_PROGRESS` 的主管节点可以继续分配。`acceptNode` 和 `rejectNode` 必须同时驱动其桥接正式子任务：接受调用正式仓储 `updateSubtaskStatus(... action: "accept")`，驳回调用 `updateSubtaskStatus(... action: "reject")`；任一侧失败可用同一 requestId 重试并由桥接协调器恢复，不允许出现第二个正式任务。

- [ ] **步骤 4：桥接每个子节点**

子节点正式任务的 `managerUserId` 为父节点承接人，`assigneeUserId` 为新承接人，`dueAt` 为子期限；描述包含质量事件编号、必要背景、父节点要求和“证据完成后提交直接上级验收”，不包含私密评论。

- [ ] **步骤 5：测试并提交**

```bash
npx vitest run tests/quality/quality-recursive-assignment.test.ts
git add src/quality/assignments tests/quality/quality-recursive-assignment.test.ts
git commit -m "feat: support recursive cross department quality delegation"
```

### 任务 5：在现有主管任务页增加质量任务区（FR-QT-UI-03）

**文件：**

- 修改：`src/web/manager-workbench-pages.ts`
- 修改：`src/web/assignment-workbench.ts`
- 修改：`src/web/quality-http.ts`
- 新增：`tests/web/manager-quality-tasks.test.ts`

- [ ] **步骤 1：先写页面兼容测试**

断言原“任务列表/调整分配”、KPI、筛选和普通任务 API 不变；主管收到质量节点后，在同一 `/workbench/manager/tasks` 页面出现“质量任务 · 待我承接”；未收到质量任务的主管不显示空白占位；页面侧栏不出现“质量追踪”。

- [ ] **步骤 2：增加独立数据端点**

```text
GET  /api/workbench/manager/quality-nodes
POST /api/workbench/manager/quality-nodes/:id/accept
POST /api/workbench/manager/quality-nodes/:id/reject
POST /api/workbench/manager/quality-nodes/:id/delegate
POST /api/workbench/manager/quality-nodes/:id/children/:childId/due
```

端点使用当前 session userId，不接受客户端传 actorUserId。

- [ ] **步骤 3：实现同页质量任务区**

每张质量卡显示：质量事件编号/标题、“质量任务”标识、事件摘要、来源质量专员、原主责、节点直接上级、节点期限、承接状态。动作只显示当前状态允许的按钮；跨部门分配复用现有通讯录搜索，但目标主管用经理名单校验。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/web/manager-quality-tasks.test.ts tests/web/assignment-workbench.test.ts
git add src/web/manager-workbench-pages.ts src/web/assignment-workbench.ts src/web/quality-http.ts tests/web/manager-quality-tasks.test.ts
git commit -m "feat: show quality assignments in manager task page"
```

### 任务 6：为员工任务增加质量背景和质量完成入口（FR-QT-UI-04）

**文件：**

- 修改：`src/web/assignment-workbench.ts`
- 修改：`src/web/employee-workbench-pages.ts`
- 新增：`tests/web/employee-quality-tasks.test.ts`

- [ ] **步骤 1：先写响应兼容测试**

普通子任务的 API JSON 与页面按钮保持原样；关联质量节点的子任务增加 `qualityContext`，包括事件编号、标题、公开摘要、原主责、直接上级和是否要求证据；不含其他分支、私密评论或质量专员内部信息。

- [ ] **步骤 2：实现批量桥接查询**

```ts
getQualityContextBySubtaskIds(
  subtaskIds: string[],
  viewerUserId: string,
): Map<string, EmployeeQualityTaskContext>;
```

单次 employee 列表请求只执行一次批量查询，禁止 N+1。

- [ ] **步骤 3：调整质量任务进度弹窗**

质量任务选择“已完成”时，页面引导先上传证据并使用质量完成接口；普通任务继续调用原 `/api/workbench/employee/subtasks/progress`。

在 `/api/workbench/employee/subtasks/action` 中先查询桥接：若命中质量节点，`accept`/`reject` 改由 `qualityAssignmentService.acceptNode` / `rejectNode` 执行，避免只更新正式子任务却遗漏质量节点；`request_changes` 和 `customize` 继续写正式任务事件，并追加不改变质量状态的公开审计摘要。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/web/employee-quality-tasks.test.ts tests/web/assignment-workbench.test.ts
git add src/web/assignment-workbench.ts src/web/employee-workbench-pages.ts tests/web/employee-quality-tasks.test.ts
git commit -m "feat: add quality context to employee tasks"
```

### 任务 7：实现证据上传、鉴权下载和完成硬门禁（FR-QT-EVD-01）

**文件：**

- 新增：`src/quality/evidence/quality-evidence-service.ts`
- 修改：`src/quality/files/quality-report-file-store.ts`
- 修改：`src/web/quality-http.ts`
- 修改：`src/web/assignment-workbench.ts`
- 新增：`tests/quality/quality-evidence-service.test.ts`
- 新增：`tests/web/quality-evidence-api.test.ts`

- [ ] **步骤 1：先写失败测试**

覆盖：仅节点承接人可上传；20 MB 上限；随机磁盘名；摘要和 MIME 入库；上传失败不出现证据行；无子节点的执行节点零证据不能完成；至少一份证据后进入 `PENDING_PARENT_REVIEW`；有子节点的主管节点只有全部直接子节点通过后才能提交汇总且无需重复上传；退回后上传形成新版本；越权下载 403；来源售后只能下载自己通报事件公开链路的证据。

- [ ] **步骤 2：实现动作接口**

```text
POST /api/workbench/quality/nodes/:id/evidence
GET  /api/workbench/quality/evidence/:id
POST /api/workbench/quality/nodes/:id/submit-completion
```

上传使用 `readMultipartSingleFile(req, { maxFileBytes: 20 * 1024 * 1024 })`。文件先写临时名并 `fsync`，原子改名成功后才写数据库；数据库失败则删除新文件。

- [ ] **步骤 3：守住原进度接口**

在 `/api/workbench/employee/subtasks/progress` 调用 `updateSubtaskStatus` 前增加：

```ts
if (progressStatus === "DONE") {
  const qualityNode = qualityStore.getNodeBySubtaskId(targetSubtaskId);
  if (qualityNode && !qualityStore.hasEvidence(qualityNode.nodeId)) {
    writeJson(res, 409, { ok: false, error: "质量任务完成前必须上传证据" });
    return;
  }
}
```

质量任务正式子任务的 DONE 只能由 `submit-completion` 服务在证据校验和节点状态事务成功后触发；普通任务仍走原路径。

主管任务页和员工任务页的质量卡都增加“上传证据/提交完成”入口；主管若存在直接子节点，页面改为展示证据汇总和“提交汇总”，不得要求再次上传下级已经提供的文件。

- [ ] **步骤 4：测试并提交**

```bash
npx vitest run tests/quality/quality-evidence-service.test.ts tests/web/quality-evidence-api.test.ts tests/web/multipart-single-file.test.ts tests/web/assignment-workbench.test.ts
git add src/quality/evidence src/quality/files/quality-report-file-store.ts src/web/quality-http.ts src/web/assignment-workbench.ts tests/quality/quality-evidence-service.test.ts tests/web/quality-evidence-api.test.ts
git commit -m "feat: require evidence for quality task completion"
```

### 任务 8：实现直接上级逐级验收与证据汇总（FR-QT-REV-01）

**文件：**

- 新增：`src/quality/reviews/quality-review-service.ts`
- 新增：`src/quality/reviews/quality-event-projector.ts`
- 修改：`src/web/quality-http.ts`
- 修改：`src/web/manager-workbench-pages.ts`
- 新增：`tests/quality/quality-review-service.test.ts`
- 新增：`tests/web/manager-quality-review.test.ts`

- [ ] **步骤 1：先写逐级验收测试**

覆盖：只有直接父节点承接人能通过/退回；退回原因必填；历史证据保留；父节点所有直接子节点通过后才可提交自身完成；所有分支通过后事件进入 `PENDING_PRIMARY_REVIEW`；原主责可通过整体或退回具体分支；总体通过后进入 `PENDING_QUALITY_REVIEW`。

- [ ] **步骤 2：实现服务动作**

```ts
reviewDirectChild(input: {
  childNodeId: string;
  actorUserId: string;
  decision: "APPROVE" | "RETURN";
  reason?: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityAssignmentNode>;

primaryReview(input: {
  eventId: string;
  primaryManagerUserId: string;
  decision: "APPROVE" | "RETURN_NODE";
  returnedNodeId?: string;
  reason?: string;
  expectedVersion: number;
  requestId: string;
}): Promise<QualityEvent>;
```

- [ ] **步骤 3：实现证据包查询**

证据包按树的深度优先顺序返回节点、负责人、部门、期限、每版证据、直接上级验收和退回历史；原主责能看全树，普通主管只看自己节点及后代，执行人只看自己的节点。

- [ ] **步骤 4：增加主管页验收区并测试**

```bash
npx vitest run tests/quality/quality-review-service.test.ts tests/web/manager-quality-review.test.ts
git add src/quality/reviews src/web/quality-http.ts src/web/manager-workbench-pages.ts tests/quality/quality-review-service.test.ts tests/web/manager-quality-review.test.ts
git commit -m "feat: add hierarchical quality evidence review"
```

### 任务 9：完成桥接一致性、提醒兼容和第二阶段全量回归（FR-QT-REG-02）

**文件：**

- 新增：`src/quality/assignments/quality-bridge-reconciler.ts`
- 新增：`tests/quality/quality-bridge-reconciler.test.ts`
- 修改：`AGENTS.md`

- [ ] **步骤 1：实现只修复可证明缺失关系的协调器**

协调器检查节点、正式任务、子任务和桥接是否一一存在。缺少桥接但确定性正式任务存在时补桥接；正式任务缺失时用相同 integrationKey 重建；字段冲突只报告 `CONFLICT`，不自动覆盖人工数据。

- [ ] **步骤 2：验证现有提醒自动覆盖质量正式子任务**

用现有 `listActiveSubtasksForReminders` 测试确认质量子任务能进入 T-1 和逾期候选；本阶段不重复发送第二套提醒。质量专员和原主责的附加通知在第三阶段 outbox 实现。

- [ ] **步骤 3：运行第二阶段定向测试**

```bash
npx vitest run tests/quality tests/web/manager-quality-tasks.test.ts tests/web/employee-quality-tasks.test.ts tests/web/quality-evidence-api.test.ts tests/web/manager-quality-review.test.ts
```

- [ ] **步骤 4：运行全量门槛**

```bash
npm run typecheck
npm test
git diff --check
rg -n "TODO|TBD|PLACEHOLDER|it\.skip|describe\.skip" src/quality tests/quality tests/web/manager-quality-* tests/web/employee-quality-* tests/web/quality-evidence-api.test.ts
```

预期：前三个命令退出 `0`，最后一个无输出。

- [ ] **步骤 5：更新说明并提交**

```bash
git add src/quality/assignments/quality-bridge-reconciler.ts tests/quality/quality-bridge-reconciler.test.ts AGENTS.md
git commit -m "test: verify quality task and evidence phase"
```

## 第二阶段验收清单

- [ ] 质量专员能指定原主责和总期限，普通售后主管不能执行这些动作。
- [ ] 主管在原任务页看到质量任务，不需要独立质量入口。
- [ ] 主管能承接、驳回、分给下属或其他部门主管，并可继续递归。
- [ ] 分配给祖先、越级改期和子期限超过父期限均被拒绝且审计。
- [ ] 原主责始终保留，所有分配边都能追溯到正式任务/子任务。
- [ ] 每个节点完成都有证据，退回不删除旧版本。
- [ ] 直接上级逐级验收；原主责查看整体证据包后通过即可送质量专员。
- [ ] 普通任务的页面、接口、发布、承接、进度和提醒行为没有变化。
- [ ] `npm run typecheck` 与 `npm test` 全部通过。
