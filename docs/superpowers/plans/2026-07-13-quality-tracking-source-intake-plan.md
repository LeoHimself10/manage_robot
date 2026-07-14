# 质量追踪第一阶段：来源、候选与通报实施计划

> **执行要求：** REQUIRED SUB-SKILL: 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 逐项实施；每一步使用复选框跟踪。

**目标：** 让售后主管在独立“质量追踪”页面只读查看钉钉第一子表、每 2 小时同步、查看可解释异常候选，并能从来源记录或手动创建、编辑、提交质量异常草稿。

**架构：** 扩展现有钉钉工作簿客户端增加只读能力；新增独立 `src/quality/` 领域、SQLite `quality_*` 表和质量 HTTP 路由；现有任务系统在本阶段不做业务改动。

**技术栈：** Node.js 22、TypeScript、`node:sqlite`、Zod、Vitest、现有服务端 HTML/原生 JavaScript、钉钉企业内部应用 OpenAPI。

## 全局约束

- [ ] 业务依据仅为 `docs/superpowers/specs/2026-07-10-quality-event-tracking-design.md` v0.3。
- [ ] 首表读取探针未通过时停止在任务 2，不继续实现来源同步页面。
- [ ] 同步只能调用 GET；生产环境不得使用浏览器 Cookie、个人登录态或抓取页面 HTML。
- [ ] 候选只给建议，不自动创建质量事件。
- [ ] 草稿仅创建人可见；来源快照只读；提交后更正必须留前后值和原因。
- [ ] 同一来源键在所有状态下最多关联一个质量事件。
- [ ] 每个接口都在服务端校验质量角色，不能只依赖导航隐藏。
- [ ] 本阶段不创建正式任务、不修改现有主管任务页动作。

---

### 任务 1：建立质量角色权限与配置契约（FR-QT-ROLE-01）

**文件：**

- 新增：`src/security/quality-capabilities.ts`
- 新增：`tests/security/quality-capabilities.test.ts`
- 修改：`.env.example`
- 修改：`docs/deploy-aliyun-dingtalk.md`

- [ ] **步骤 1：先写失败测试**

```ts
it("售后主管和质量专员在任意工作台视图都保留质量入口能力", () => {
  vi.stubEnv("QUALITY_AFTERSALES_MANAGER_USER_IDS", "after-1");
  vi.stubEnv("QUALITY_SPECIALIST_USER_IDS", "quality-1");
  expect(resolveQualityCapabilities("after-1").canAccessTracking).toBe(true);
  expect(resolveQualityCapabilities("quality-1").canAccessTracking).toBe(true);
});

it("只允许配置关系中的下级进入质量意见", () => {
  writeFileSync(reportFile, JSON.stringify({ "quality-1": ["report-1"] }));
  expect(resolveQualityCapabilities("report-1").canAccessOpinions).toBe(true);
  expect(resolveQualityCapabilities("report-2").canAccessOpinions).toBe(false);
});
```

- [ ] **步骤 2：运行测试并确认失败**

```bash
npx vitest run tests/security/quality-capabilities.test.ts
```

预期：因 `quality-capabilities.ts` 不存在而失败。

- [ ] **步骤 3：实现最小权限模型**

```ts
export type QualityBusinessRole =
  | "aftersales_manager"
  | "quality_specialist"
  | "quality_report";

export interface QualityCapabilities {
  roles: QualityBusinessRole[];
  canAccessTracking: boolean;
  canAccessOpinions: boolean;
  specialistUserIds: string[];
}

export function resolveQualityCapabilities(userId: string): QualityCapabilities;
export function isQualitySpecialistForReport(
  specialistUserId: string,
  reportUserId: string,
): boolean;
```

配置规则固定为：

```text
QUALITY_AFTERSALES_MANAGER_USER_IDS=uid1,uid2
QUALITY_SPECIALIST_USER_IDS=uid3
QUALITY_SPECIALIST_REPORTS_FILE=data/quality-specialist-reports.json
```

关系文件固定格式：

```json
{
  "uid3": ["uid4", "uid5"]
}
```

- [ ] **步骤 4：补充部署说明并运行测试**

```bash
npx vitest run tests/security/quality-capabilities.test.ts
```

预期：全部通过，且姓名“佟成”没有出现在权限判断源码中。

- [ ] **步骤 5：提交**

```bash
git add src/security/quality-capabilities.ts tests/security/quality-capabilities.test.ts .env.example docs/deploy-aliyun-dingtalk.md
git commit -m "feat: add quality business capabilities"
```

### 任务 2：扩展钉钉工作簿只读客户端并完成真实访问探针（FR-QT-SRC-01）

**文件：**

- 修改：`src/agent/daily-report-digest/dingtalk-workbook-client.ts`
- 新增：`tests/agent/daily-report-digest/dingtalk-workbook-read.test.ts`
- 新增：`scripts/probe-quality-source.ts`
- 修改：`package.json`
- 新增：`docs/quality-source-connector-verification.md`

- [ ] **步骤 1：先写工作表属性与单元格读取失败测试**

```ts
it("读取指定工作表的非空范围且只发出 GET", async () => {
  const client = createDingTalkWorkbookClient({ fetchImpl });
  const sheet = await client.getSheetProperties("app", "secret", doc, "book-1", "sheet-1");
  const values = await client.readSheetValues(
    "app", "secret", doc, "book-1", "sheet-1", "A1:S1605",
  );
  expect(sheet).toMatchObject({ id: "sheet-1", lastNonEmptyRow: 1604 });
  expect(values[0][0]).toBe("反馈时间");
  expect(fetchImpl.mock.calls.every((call) => call[1]?.method === "GET" || call[0].toString().includes("accessToken"))).toBe(true);
});
```

- [ ] **步骤 2：确认测试失败**

```bash
npx vitest run tests/agent/daily-report-digest/dingtalk-workbook-read.test.ts
```

预期：缺少 `getSheetProperties` 和 `readSheetValues`。

- [ ] **步骤 3：实现明确的只读接口**

```ts
async function getSheetProperties(
  appKey: string,
  appSecret: string,
  doc: DailyReportDocConfig,
  workbookId: string,
  sheetId: string,
): Promise<{ id: string; name: string; lastNonEmptyRow: number; lastNonEmptyColumn: number }>;

async function readSheetValues(
  appKey: string,
  appSecret: string,
  doc: DailyReportDocConfig,
  workbookId: string,
  sheetId: string,
  rangeAddress: string,
): Promise<unknown[][]>;
```

读取路径固定为：

```text
GET /v1.0/doc/workbooks/{workbookId}/sheets/{sheetId}?operatorId={operatorUnionId}
GET /v1.0/doc/workbooks/{workbookId}/sheets/{sheetId}/ranges/{rangeAddress}?select=values&operatorId={operatorUnionId}
```

读取权限使用企业内部应用“钉钉表格读权限”。工作簿 ID 读取 `QUALITY_SOURCE_WORKBOOK_ID`，不得从分享 URL 猜测；原表链接只用于页面跳转。

- [ ] **步骤 4：新增只读探针脚本**

`package.json` 增加：

```json
"quality:source-probe": "tsx scripts/probe-quality-source.ts"
```

探针必须依次断言：应用凭据存在、首个工作表名称严格等于“客户端问题反馈记录表”、首行包含“反馈时间”“问题描述”“问题归类”、数据行数大于 0；只输出工作表名、行列数和表头，不输出业务行正文或密钥。

- [ ] **步骤 5：运行单元测试和真实探针**

```bash
npx vitest run tests/agent/daily-report-digest/dingtalk-workbook-read.test.ts
npm run quality:source-probe
```

预期：单元测试通过；探针输出 `客户端问题反馈记录表`、非零行数和表头后退出 `0`。若返回 403、首表名称不同或工作簿 ID 无效，记录实际错误到 `docs/quality-source-connector-verification.md` 并暂停后续开发，不改用浏览器抓取。

- [ ] **步骤 6：记录已验证契约并提交**

文档只记录权限名称、目标表、探针时间、行列数、API 路径和结果，不记录 Client Secret、Access Token 或业务正文。

```bash
git add src/agent/daily-report-digest/dingtalk-workbook-client.ts tests/agent/daily-report-digest/dingtalk-workbook-read.test.ts scripts/probe-quality-source.ts package.json docs/quality-source-connector-verification.md
git commit -m "feat: add verified readonly quality workbook access"
```

### 任务 3：建立第一阶段独立质量数据表与仓储（FR-QT-DATA-01）

**文件：**

- 新增：`src/quality/domain/quality-types.ts`
- 新增：`src/quality/infra/quality-store.ts`
- 新增：`tests/quality/quality-store.test.ts`

- [ ] **步骤 1：先写失败测试，覆盖建表、唯一来源和版本并发**

```ts
it("同一来源键不能关联两个事件", () => {
  store.linkSourceToEvent(eventA.eventId, sourceSnapshot);
  expect(() => store.linkSourceToEvent(eventB.eventId, sourceSnapshot)).toThrow("source already reported");
});

it("旧版本不能覆盖新草稿", () => {
  const saved = store.updateDraft({ eventId, actorUserId, expectedVersion: 1, patch });
  expect(saved.version).toBe(2);
  expect(() => store.updateDraft({ eventId, actorUserId, expectedVersion: 1, patch })).toThrow("version conflict");
});
```

- [ ] **步骤 2：确认测试失败**

```bash
npx vitest run tests/quality/quality-store.test.ts
```

- [ ] **步骤 3：实现领域状态和第一阶段表**

```ts
export type QualityEventStatus =
  | "DRAFT"
  | "PENDING_ASSIGNMENT"
  | "PENDING_ACCEPTANCE"
  | "IN_PROGRESS"
  | "PENDING_PRIMARY_REVIEW"
  | "PENDING_QUALITY_REVIEW"
  | "CLOSED";
export type QualityCandidateStatus = "OPEN" | "DISMISSED" | "REPORTED";
export type QualitySourceState = "ACTIVE" | "UPDATED" | "DELETED";
```

仓储在 `resolveWorkbenchSqlitePath()` 指向的同一文件创建以下表，不修改 `tasks` 或 `subtasks`：

```sql
quality_source_sync_state
quality_source_rows
quality_candidates
quality_events
quality_event_source_links
quality_event_relations
quality_event_supplements
quality_report_files
quality_audit_events
```

关键数据库约束：

```sql
UNIQUE(quality_event_source_links.source_key)
CHECK(quality_events.status IN ('DRAFT','PENDING_ASSIGNMENT','PENDING_ACCEPTANCE','IN_PROGRESS','PENDING_PRIMARY_REVIEW','PENDING_QUALITY_REVIEW','CLOSED'))
CHECK(quality_candidates.status IN ('OPEN','DISMISSED','REPORTED'))
```

第一阶段服务只允许写入 `DRAFT` 和 `PENDING_ASSIGNMENT`；提前保留完整数据库枚举是为了避免第二阶段通过重建表修改 SQLite `CHECK` 约束。

所有可更新聚合含 `version INTEGER NOT NULL DEFAULT 1`；所有审计记录包含 `event_id`、`actor_user_id`、`actor_role`、`action`、`before_json`、`after_json`、`reason`、`request_id`、`occurred_at`。

- [ ] **步骤 4：实现关闭与测试**

仓储公开 `close()`；测试临时数据库必须在 `afterEach` 关闭。

```bash
npx vitest run tests/quality/quality-store.test.ts
```

预期：建表幂等、来源唯一、版本冲突、审计不可变测试通过。

- [ ] **步骤 5：提交**

```bash
git add src/quality/domain/quality-types.ts src/quality/infra/quality-store.ts tests/quality/quality-store.test.ts
git commit -m "feat: add quality source and event store"
```

### 任务 4：实现首表规范化、差异保留和两小时同步（FR-QT-SRC-02）

**文件：**

- 新增：`src/quality/source/quality-source-schema.ts`
- 新增：`src/quality/source/dingtalk-quality-source.ts`
- 新增：`src/quality/source/quality-source-sync.ts`
- 新增：`src/quality/source/quality-source-scheduler.ts`
- 新增：`tests/quality/quality-source-sync.test.ts`
- 新增：`tests/quality/fixtures/client-feedback-sheet.json`

- [ ] **步骤 1：先写规范化与同步失败测试**

测试必须覆盖：反馈单号优先作来源键；缺失反馈单号时按反馈时间、反馈人、序列号、问题描述生成 SHA-256；空行跳过；历史行被修改时保留旧摘要并标记 `UPDATED`；远端缺失行标记 `DELETED`；同步失败保留上次成功缓存。

```bash
npx vitest run tests/quality/quality-source-sync.test.ts
```

预期：模块不存在而失败。

- [ ] **步骤 2：实现固定表头映射**

```ts
export const QUALITY_SOURCE_HEADERS = {
  feedbackAt: ["反馈时间"],
  feedbackNo: ["反馈单号"],
  reporter: ["反馈人员", "反馈人"],
  deviceModel: ["设备型号"],
  serialNo: ["设备序列号"],
  catheterBatch: ["报损导管批次", "导管批次"],
  issueDescription: ["问题描述"],
  clinicianAware: ["术者是否可以感知"],
  impact: ["对术者造成的影响"],
  confirmation: ["确认情况"],
  owner: ["责任人"],
  returned: ["导管是否寄回"],
  category: ["问题归类"],
  status: ["状态"],
  solutionEngineer: ["解决工程师"],
  solution: ["解决工程师及方案", "解决方案"],
  finalCause: ["最终原因和解决措施"],
  customerFollowup: ["客服跟踪反馈"],
} as const;
```

遇到重复表头、缺少“反馈时间”或“问题描述”时，本次同步失败并保留缓存，不做错位导入。

- [ ] **步骤 3：实现原子同步**

同步先写 `RUNNING`，在一个 SQLite 事务中 upsert 当前行、标记远端缺失、写变更审计和 `last_succeeded_at`；任何错误回滚数据更新，仅写 `last_failed_at` 和裁剪到 500 字的错误摘要。

- [ ] **步骤 4：实现两小时调度器**

```ts
export const QUALITY_SOURCE_SYNC_INTERVAL_MS = 2 * 60 * 60 * 1000;

export function createQualitySourceScheduler(deps?: {
  runSync?: () => Promise<void>;
  intervalMs?: number;
}): { runOnce(): Promise<void>; startIntervalLoop(): void; stopIntervalLoop(): void };
```

调度器启动时立即尝试一次；运行中重入直接跳过；失败写结构化日志但不终止进程。

- [ ] **步骤 5：运行测试并提交**

```bash
npx vitest run tests/quality/quality-source-sync.test.ts
git add src/quality/source tests/quality/quality-source-sync.test.ts tests/quality/fixtures/client-feedback-sheet.json
git commit -m "feat: sync quality source every two hours"
```

### 任务 5：实现可解释异常候选与数据待完善分流（FR-QT-CAND-01）

**文件：**

- 新增：`src/quality/candidates/quality-candidate-detector.ts`
- 新增：`src/quality/candidates/quality-similarity.ts`
- 新增：`tests/quality/quality-candidate-detector.test.ts`
- 修改：`.env.example`

- [ ] **步骤 1：先写四类规则测试**

测试固定覆盖：同批次相似问题 30 天内 2 次、同型号同分类 30 天内 3 次、高风险词、历史相似；只有日期错误或字段缺失时输出 `DATA_INCOMPLETE` 而不是候选。

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/quality/quality-candidate-detector.test.ts
```

- [ ] **步骤 3：实现确定性规则**

```ts
export interface CandidateTrigger {
  code: "BATCH_REPEAT" | "MODEL_CATEGORY_REPEAT" | "HIGH_RISK_KEYWORD" | "HISTORY_SIMILAR";
  label: string;
  sourceKeys: string[];
  facts: Record<string, string | number>;
}

export interface CandidateDecision {
  kind: "QUALITY_CANDIDATE" | "DATA_INCOMPLETE" | "NONE";
  triggers: CandidateTrigger[];
  similarSourceKeys: string[];
  similarEventIds: string[];
}
```

相似度使用中文字符二元组 Dice 系数，阈值默认 `0.72`；比较前去空白、标点和大小写。默认高风险词为 `断裂,无法使用,术中异常,无法成像`。配置变量：

```text
QUALITY_CANDIDATE_WINDOW_DAYS=30
QUALITY_BATCH_REPEAT_THRESHOLD=2
QUALITY_MODEL_CATEGORY_THRESHOLD=3
QUALITY_TEXT_SIMILARITY_THRESHOLD=0.72
QUALITY_HIGH_RISK_KEYWORDS=断裂,无法使用,术中异常,无法成像
```

- [ ] **步骤 4：实现候选幂等刷新**

候选指纹为排序后的来源键、触发码和规则版本的 SHA-256；重复同步更新同一候选。`DISMISSED` 候选只有关联来源摘要变化时重新进入 `OPEN`，并保留旧决定审计。

每次来源同步事务成功后调用一次候选刷新；候选刷新失败只记录失败并保留上一版候选，不回滚已经成功的来源缓存，也不自动创建事件。

- [ ] **步骤 5：测试和提交**

```bash
npx vitest run tests/quality/quality-candidate-detector.test.ts
git add src/quality/candidates tests/quality/quality-candidate-detector.test.ts .env.example
git commit -m "feat: detect explainable quality candidates"
```

### 任务 6：实现草稿、提交、更正、补充和防重复服务（FR-QT-EVT-01）

**文件：**

- 新增：`src/quality/events/quality-event-schema.ts`
- 新增：`src/quality/events/quality-event-service.ts`
- 新增：`src/quality/files/quality-report-file-store.ts`
- 新增：`tests/quality/quality-event-service.test.ts`
- 新增：`tests/quality/quality-report-file-store.test.ts`

- [ ] **步骤 1：先写业务动作失败测试**

覆盖：来源预填可编辑但快照不变；手动草稿；非创建人读写草稿被拒；提交进入 `PENDING_ASSIGNMENT`；相同来源重复通报返回原事件；相似事件独立创建必须有原因；提交后无痕改正文被拒；更正保留前后值；补充不改原正文。

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/quality/quality-event-service.test.ts tests/quality/quality-report-file-store.test.ts
```

- [ ] **步骤 3：实现 Zod 输入与动作接口**

```ts
export const qualityDraftInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  currentSituation: z.string().trim().min(1).max(10000),
  occurredAt: z.string().trim().max(64).optional(),
  reporter: z.string().trim().max(100).optional(),
  deviceModel: z.string().trim().max(200).optional(),
  serialNo: z.string().trim().max(200).optional(),
  catheterBatch: z.string().trim().max(200).optional(),
  clinicianAware: z.string().trim().max(500).optional(),
  impact: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(200).optional(),
  urgency: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  notes: z.string().trim().max(10000).optional(),
  expectedVersion: z.number().int().positive(),
  requestId: z.string().uuid(),
});
```

服务公开动作：

```ts
createDraftFromSources
createManualDraft
getDraftForCreator
updateDraft
deleteDraft
submitDraft
dismissCandidate
addSourcesToDraft
addSourceToActiveEvent
createRelatedIndependentDraft
addSupplement
correctSubmittedReport
```

每个写动作在同一事务中更新聚合、增加版本并写 `quality_audit_events`。

- [ ] **步骤 4：实现报告附件安全存储**

文件根目录读取 `QUALITY_FILE_DIR`，默认 `data/quality-files`。磁盘名使用 UUID；保留原名仅作转义后的元数据。单文件 20 MB；允许 PDF、常见图片、Office 文档和纯文本；写入时计算 SHA-256。下载只能通过鉴权接口按文件 ID 流出，不暴露物理路径。

- [ ] **步骤 5：测试和提交**

```bash
npx vitest run tests/quality/quality-event-service.test.ts tests/quality/quality-report-file-store.test.ts
git add src/quality/events src/quality/files tests/quality/quality-event-service.test.ts tests/quality/quality-report-file-store.test.ts
git commit -m "feat: add audited quality event intake"
```

### 任务 7：增加质量导航和独立 HTTP 路由骨架（FR-QT-UI-01）

**文件：**

- 新增：`src/web/quality-http.ts`
- 新增：`src/web/quality-tracking-page.ts`
- 新增：`src/web/quality-tracking-styles.ts`
- 修改：`src/web/workbench-shell.ts`
- 修改：`src/web/assignment-workbench.ts`
- 新增：`tests/web/quality-access.test.ts`
- 修改：`tests/web/assignment-workbench.test.ts`

- [ ] **步骤 1：先写页面与接口权限测试**

断言售后主管和质量专员在 manager/employee 任一当前视图都看到“质量追踪”；普通主管无入口且直接 GET 返回 403；质量专员下级只看到“质量意见”而看不到“质量追踪”；外部密码账号不能获得质量角色。

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/web/quality-access.test.ts tests/web/assignment-workbench.test.ts
```

- [ ] **步骤 3：扩展工作台导航**

`WorkbenchNavId` 增加：

```ts
| "quality-tracking"
| "quality-opinions";
```

`renderWorkbenchPage` 根据 `sessionUserId` 的质量能力，把质量入口追加到当前角色侧栏；不要求切换 manager/employee 视图。

- [ ] **步骤 4：添加独立路由委派**

```ts
export interface QualityHttpSession {
  userId: string;
  role: "admin" | "manager" | "employee";
  dingUser?: { name?: string };
  loginSource?: string;
}

export function handleQualityHttp(input: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  session: QualityHttpSession;
}): boolean;
```

`assignment-workbench.ts` 在通用会话解析后调用该路由；质量路由不导入主管聊天或 Agent 编排器。

- [ ] **步骤 5：建立第一阶段路由集合**

```text
GET  /workbench/quality
GET  /api/workbench/quality/source
POST /api/workbench/quality/source/sync
GET  /api/workbench/quality/candidates
POST /api/workbench/quality/candidates/:id/dismiss
GET  /api/workbench/quality/events
POST /api/workbench/quality/events/drafts
GET  /api/workbench/quality/events/:id
PATCH /api/workbench/quality/events/:id/draft
DELETE /api/workbench/quality/events/:id/draft
POST /api/workbench/quality/events/:id/submit
POST /api/workbench/quality/events/:id/supplements
POST /api/workbench/quality/events/:id/corrections
POST /api/workbench/quality/events/:id/files
GET  /api/workbench/quality/files/:id
```

同步 POST 仅售后主管允许；提交事件仅草稿创建人允许；质量专员可读已提交事件但不能读其他人的草稿。

- [ ] **步骤 6：测试和提交**

```bash
npx vitest run tests/web/quality-access.test.ts tests/web/assignment-workbench.test.ts
git add src/web/quality-http.ts src/web/quality-tracking-page.ts src/web/quality-tracking-styles.ts src/web/workbench-shell.ts src/web/assignment-workbench.ts tests/web/quality-access.test.ts tests/web/assignment-workbench.test.ts
git commit -m "feat: add gated quality tracking route"
```

### 任务 8：实现售后主管页面模型的真实交互（FR-QT-UI-02）

**文件：**

- 修改：`src/web/quality-tracking-page.ts`
- 修改：`src/web/quality-tracking-styles.ts`
- 新增：`tests/web/quality-tracking-page.test.ts`
- 新增：`tests/web/quality-intake-api.test.ts`

- [ ] **步骤 1：先写渲染与 API 测试**

测试页面包含“新建质量异常”“需求管理记录表 · 客户端问题反馈记录表”“每 2 小时自动同步”“立即同步”“打开钉钉原表”“异常候选”“全部反馈”“已通报”“我通报的事件”；测试来源通报预填、手动新建、保存草稿、提交、冲突 409、重复来源 409 并返回已有事件 ID。

- [ ] **步骤 2：确认失败**

```bash
npx vitest run tests/web/quality-tracking-page.test.ts tests/web/quality-intake-api.test.ts
```

- [ ] **步骤 3：实现只读来源和候选列表**

列表默认分页 50 条，服务端参数上限 200；搜索仅查反馈单号、型号、序列号、批次、描述和分类。页面显示最近成功时间、当前状态和失败摘要；失败时明确标注“正在使用最近成功数据”。

- [ ] **步骤 4：实现两个可编辑草稿入口**

来源通报把勾选的来源键传给服务端，由服务端从缓存预填；手动新建不含来源键。表单始终显示只读“来源快照”区域；保存和提交带 `expectedVersion` 与 UUID `requestId`。

- [ ] **步骤 5：实现已通报与事件详情**

售后主管只能看到自己创建的已提交事件及公开补充；质量专员看到所有已提交事件。本阶段待分配详情不显示分配动作，留到第二阶段。

- [ ] **步骤 6：移动端和无脚本安全检查**

CSS 在 320px 宽度不产生页面级横向滚动；所有动态文本通过 `textContent` 插入；服务端 HTML 对预置文本调用 `escapeHtml`。

- [ ] **步骤 7：测试和提交**

```bash
npx vitest run tests/web/quality-tracking-page.test.ts tests/web/quality-intake-api.test.ts
git add src/web/quality-tracking-page.ts src/web/quality-tracking-styles.ts tests/web/quality-tracking-page.test.ts tests/web/quality-intake-api.test.ts
git commit -m "feat: build aftersales quality intake page"
```

### 任务 9：接入运行时调度并完成第一阶段回归（FR-QT-REG-01）

**文件：**

- 修改：`src/dingtalk-bot.ts`
- 新增：`tests/quality/quality-source-scheduler.test.ts`
- 修改：`vitest.setup.ts`
- 修改：`AGENTS.md`

- [ ] **步骤 1：先写调度器生命周期测试**

使用 fake timers 断言启动立即同步一次、2 小时后再同步一次、重入不并发、关闭后不再执行；测试环境默认禁止真实网络和后台循环。

- [ ] **步骤 2：接入主进程**

```ts
const qualitySourceScheduler = createQualitySourceScheduler();
qualitySourceScheduler.startIntervalLoop();
```

只有企业读取配置完整时调度器启用；配置不完整时记录一次 `quality_source_sync_disabled`，不得影响 HTTP 服务和现有 scheduler。

- [ ] **步骤 3：运行阶段定向测试**

```bash
npx vitest run tests/security/quality-capabilities.test.ts tests/quality tests/web/quality-access.test.ts tests/web/quality-tracking-page.test.ts tests/web/quality-intake-api.test.ts
```

预期：全部通过。

- [ ] **步骤 4：运行完整质量门槛**

```bash
npm run typecheck
npm test
git diff --check
rg -n "TODO|TBD|PLACEHOLDER|it\.skip|describe\.skip" src/quality tests/quality src/web/quality-* docs/quality-source-connector-verification.md
```

预期：前三个命令退出 `0`；最后一个命令无输出。若已有仓库其他目录存在历史占位，不扩大扫描范围。

- [ ] **步骤 5：更新项目说明并提交**

`AGENTS.md` 增加质量第一阶段的角色配置、来源只读、两小时调度、页面路径和测试路径。

```bash
git add src/dingtalk-bot.ts tests/quality/quality-source-scheduler.test.ts vitest.setup.ts AGENTS.md
git commit -m "test: verify quality source intake phase"
```

## 第一阶段验收清单

- [ ] 企业应用真实探针能读取且只读取第一个子表。
- [ ] 同步间隔为 2 小时，手动同步可用，失败继续显示上次成功数据。
- [ ] 候选能解释规则，数据缺失不会被误报为质量候选。
- [ ] 来源通报和手动新建均可编辑、保存和提交。
- [ ] 同一来源不能重复通报；相似事件的加入/独立创建规则生效。
- [ ] 草稿、提交后更正、补充和附件都有权限及审计。
- [ ] 售后主管与质量专员始终看到入口，普通主管看不到。
- [ ] 没有创建正式任务，也没有改变现有任务操作行为。
- [ ] `npm run typecheck` 与 `npm test` 全部通过。
