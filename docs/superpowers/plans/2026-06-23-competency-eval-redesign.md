# 能力评估模块重新设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 rubric 路线，改为自由分析。岗位要求作为可选背景上下文，AI 输出由问题驱动。

**Architecture:**
- 前端：修改 UI 文案和 banner 逻辑，去掉 rubric 相关状态
- API：删除 rubric CRUD 端点，新增 job-req 端点
- Agent 工具链：删除 `list_rubrics`/`get_rubric` 工具，修改 `get_employee_daily_reports` description
- 存储层：`rubric-store.ts` 整个文件删除；session store 去掉 rubric 字段

**Tech Stack:** TypeScript, SSE, 文件系统存储

---

## 文件变更总览

| 文件 | 变化 |
|------|------|
| `src/agent/competency-eval/rubric-store.ts` | 删除 |
| `src/agent/competency-eval/rubric-extract.ts` | 删除 |
| `src/agent/tools/competency-eval-tools.ts` | 删除 rubric 工具和 handler |
| `src/agent/competency-eval/competency-eval-agent-turn.ts` | 删除 rubric context 注入 |
| `src/agent/competency-eval/competency-eval-session-store.ts` | 删除 `activeRubricId`/`rubricTitle`/`rubricDimCount` 字段 |
| `src/web/competency-eval-page.ts` | UI 文案改为"岗位要求"，去掉 rubric banner 逻辑 |
| `src/web/competency-eval-api.ts` | 删除 rubric handler，新增 job-req handler |
| `src/web/assignment-workbench.ts` | 删除 rubric 路由和 handler 调用 |
| `tests/agent/competency-eval/daily-reports-for-eval.test.ts` | 检查是否依赖 rubric，无则保留 |

---

## Task 1: 更新 session store — 去掉 rubric 字段

**Files:**
- Modify: `src/agent/competency-eval/competency-eval-session-store.ts`

- [ ] **Step 1: 修改 `CompEvalSessionListItem` 接口，去掉 rubric 字段**

```typescript
export interface CompEvalSessionListItem {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  // 删除: activeRubricId?: string;
  // 删除: rubricTitle?: string;
  // 删除: rubricDimCount?: number;
}
```

- [ ] **Step 2: 修改 `CompEvalSession` 接口，去掉 rubric 字段**

```typescript
export interface CompEvalSession {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: CompEvalChatMessage[];
  // 删除: activeRubricId?: string;
  // 删除: rubricTitle?: string;
  // 删除: rubricDimCount?: number;
}
```

- [ ] **Step 3: 修改 `toListItem` 函数**

去掉 `activeRubricId`、`rubricTitle`、`rubricDimCount` 赋值。

- [ ] **Step 4: 修改 `normalizeSession` 函数**

去掉这三个字段的 normalize 逻辑。

- [ ] **Step 5: 修改 `saveCompEvalSession` patch 类型和逻辑**

```typescript
// patch 类型去掉:
// activeRubricId?: string;
// rubricTitle?: string;
// rubricDimCount?: number;
```

- [ ] **Step 6: 修改 `resolveCompetencyEvalDataDir` import 来源**

原来从 `rubric-store.ts` 导入 `resolveCompetencyEvalDataDir`。改为直接在 `competency-eval-session-store.ts` 中定义（或建一个共享的小模块）。**注意**：`rubric-store.ts` 删除后 import 会断，需先确认其他文件是否也引用这个函数。

先检查哪些文件引用了 `resolveCompetencyEvalDataDir`：
```bash
grep -r "resolveCompetencyEvalDataDir" src/
```

如果只有 `rubric-store.ts` 和 `competency-eval-session-store.ts` 引用，则把函数体移到 session-store 里。

- [ ] **Step 7: 提交**

```bash
git add src/agent/competency-eval/competency-eval-session-store.ts
git commit -m "refactor(competency-eval): 去掉 session store 中的 rubric 字段"
```

---

## Task 2: 更新 competency eval API — 删除 rubric 端点，新增 job-req

**Files:**
- Modify: `src/web/competency-eval-api.ts`

- [ ] **Step 1: 删除 rubric 相关导入和函数**

删除:
- `saveUploadedRubric`
- `deleteRubric`
- `listRubrics`
- `handleCompetencyEvalRubricUpload`
- `handleCompetencyEvalRubricDelete`
- `buildCompetencyEvalRubricsPayload`
- `parseCompetencyEvalRubricIdFromPath`

- [ ] **Step 2: 新增 job-req 类型定义**

```typescript
export interface JobReqMeta {
  jobReqId: string;
  filename: string;
  uploadedAt: string;
}
```

- [ ] **Step 3: 新增 job-req 上传处理函数**

岗位要求文档的存储可以用类似 rubric 的文件结构：
```
data/competency-eval/users/{userId}/job-reqs/{jobReqId}/
  source.md   # 原始文件内容
  meta.json   # JobReqMeta
```

新增函数:
- `saveJobReq(userId, filename, buffer)` → 保存文件，返回 JobReqMeta
- `getJobReq(userId, jobReqId)` → 读取内容和 meta
- `listJobReqs(userId)` → 列出用户所有岗位要求
- `deleteJobReq(userId, jobReqId)` → 删除

- [ ] **Step 4: 新增 job-req API handler 函数**

```typescript
export function handleJobReqUpload(input: {
  userId: string;
  filename: string;
  buffer: Buffer;
}): Promise<Record<string, unknown>> {
  // 类似 handleCompetencyEvalRubricUpload，但只保存文件
}

export function handleJobReqDelete(userId: string, jobReqId: string): Record<string, unknown> {
  // 类似 handleCompetencyEvalRubricDelete
}

export function buildJobReqsPayload(userId: string): Record<string, unknown> {
  return { ok: true, jobReqs: listJobReqs(userId) };
}
```

- [ ] **Step 5: 提交**

```bash
git add src/web/competency-eval-api.ts
git commit -m "refactor(competency-eval): 删除 rubric API，新增 job-req API"
```

---

## Task 3: 更新 competency eval tools — 删除 rubric 工具

**Files:**
- Modify: `src/agent/tools/competency-eval-tools.ts`

- [ ] **Step 1: 删除 rubric 工具定义和 handler**

删除:
- `LIST_RUBRICS_TOOL`
- `GET_RUBRIC_TOOL`
- `buildListRubricsHandler`
- `buildGetRubricHandler`
- 对 `rubric-store.ts` 的 import

- [ ] **Step 2: 修改 `GET_EMPLOYEE_DAILY_REPORTS_TOOL` description**

去掉 "对照 rubric 维度做证据型评估" 等描述，改为：
```
拉取指定员工在日期区间内的钉钉日报/工作日志。返回按日期排序的日志条目，供定性评估分析。
```

- [ ] **Step 3: 提交**

```bash
git add src/agent/tools/competency-eval-tools.ts
git commit -m "refactor(competency-eval): 删除 list_rubrics/get_rubric 工具"
```

---

## Task 4: 更新 agent turn — 删除 rubric context 注入

**Files:**
- Modify: `src/agent/competency-eval/competency-eval-agent-turn.ts`

- [ ] **Step 1: 删除 `buildCompetencyEvalContextPrefix` 函数**

整个函数删除。这是 rubric 注入到 userMessage 的逻辑。

- [ ] **Step 2: 修改 `runCompetencyEvalTurn` 调用**

去掉 `buildCompetencyEvalContextPrefix` 的调用，改为直接用 userMessage（或如果有 job-req 上下文，在 runOrchestrator 外部处理）。

如果 job-req 也作为 context 注入，新的 context prefix 逻辑为：
```typescript
// job-req context（如果有 activeJobReqId）
function buildJobReqContextPrefix(userId: string, jobReqId: string): string {
  if (!jobReqId) return "";
  const jobReq = getJobReq(userId, jobReqId);
  if (!jobReq.ok) return "";
  return `[context] 岗位要求:\n${jobReq.content}\n\n`;
}
```

- [ ] **Step 3: 修改 `CompetencyEvalAgentTurnInput` 接口**

去掉 `activeRubricId`，改为 `activeJobReqId?: string`。

- [ ] **Step 4: 修改 `buildCompetencyEvalClientConfig`**

不影响，保留。

- [ ] **Step 5: 提交**

```bash
git add src/agent/competency-eval/competency-eval-agent-turn.ts
git commit -m "refactor(competency-eval): 删除 rubric context 注入逻辑"
```

---

## Task 5: 更新 routing — 删除 rubric 路由

**Files:**
- Modify: `src/web/assignment-workbench.ts`

- [ ] **Step 1: 删除 rubric 相关 import**

删除 `handleCompetencyEvalRubricDelete`、`handleCompetencyEvalRubricUpload`、`buildCompetencyEvalRubricsPayload`、`parseCompetencyEvalRubricIdFromPath`。

- [ ] **Step 2: 删除 rubric upload 路由块（约 line 4148-4180）**

整块删除 `if (req.method === "POST" && url.pathname === "/api/workbench/competency-eval/rubrics/upload")`

- [ ] **Step 3: 删除 rubric GET 路由（约 line 4141-4145）**

`if (isGetOrHead && url.pathname === "/api/workbench/competency-eval/rubrics")`

- [ ] **Step 4: 删除 rubric DELETE 路由（约 line 4184-4191）**

在 DELETE 块里删除 rubricId 相关处理。

- [ ] **Step 5: 修改 chat handler 中的 `activeRubricId`**

找到约 line 3137，把 `activeRubricId` 改为 `activeJobReqId`：
```typescript
const activeJobReqId = String(body.activeJobReqId ?? "").trim() || undefined;
// 传入 agent turn 时:
activeJobReqId,
```

- [ ] **Step 6: 提交**

```bash
git add src/web/assignment-workbench.ts
git commit -m "refactor(competency-eval): 删除 rubric 路由和 handler"
```

---

## Task 6: 更新 UI — 去掉 rubric 文案和 banner

**Files:**
- Modify: `src/web/competency-eval-page.ts`

- [ ] **Step 1: 替换 topbar 按钮文案**

```typescript
// 从: "上传标准" → "上传岗位要求"
<span class="ce-upload-text">上传岗位要求</span>
```

- [ ] **Step 2: 替换 topbar banner 逻辑**

原来的 `compEvalRubricBanner`（显示 rubric 维度数）改为显示岗位要求文件名：
```typescript
<div class="ce-jobreq-pill" id="compEvalJobReqBanner" hidden>
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>
  <span id="compEvalJobReqLabel"></span>
</div>
```

- [ ] **Step 3: 替换空状态描述**

```typescript
// 从: "先上传能力标准文档，再用人名 + 时间范围提问" → "上传岗位要求（可选），用人名 + 时间范围提问"
```

- [ ] **Step 4: 更新 client JS 中的 rubric 相关逻辑**

删除:
- `rubricBanner`/`rubricLabel` 变量引用
- `setRubricBanner` 函数
- `applySessionRubric` 函数
- `uploadRubric` 改为 `uploadJobReq`
- session 持久化中的 `activeRubricId`/`rubricTitle`/`rubricDimCount`

新增:
- `setJobReqBanner(filename)` 显示岗位要求文件名
- `uploadJobReq(file)` 上传到新端点
- session 持久化 `activeJobReqId`/`jobReqFilename`

- [ ] **Step 5: 更新 API 端点路径**

`/rubrics/upload` → `/job-req/upload`
`/rubrics` GET → `/job-reqs`

- [ ] **Step 6: 提交**

```bash
git add src/web/competency-eval-page.ts
git commit -m "refactor(competency-eval): UI 文案从 rubric 改为岗位要求
```

---

## Task 7: 删除 rubric-store 和 rubric-extract

**Files:**
- Delete: `src/agent/competency-eval/rubric-store.ts`
- Delete: `src/agent/competency-eval/rubric-extract.ts`

- [ ] **Step 1: 确认无其他 import**

```bash
grep -r "rubric-store\|rubric-extract" src/
```
确保只有被删除的文件引用自己（Task 1-5 已处理其他引用）。

- [ ] **Step 2: 删除文件**

```bash
git rm src/agent/competency-eval/rubric-store.ts src/agent/competency-eval/rubric-extract.ts
```

- [ ] **Step 3: 提交**

```bash
git commit -m "refactor(competency-eval): 删除 rubric-store 和 rubric-extract
```

---

## Task 8: 更新 competency eval API 中对 session store 的 import

**Files:**
- Modify: `src/web/competency-eval-api.ts`

- [ ] **Step 1: 确认 competency-eval-session-store 的 import 变化**

Task 1 后 session store 不再从 rubric-store 导入 `resolveCompetencyEvalDataDir`。确认 api 文件中对 session store 的 import 仍然有效。

- [ ] **Step 2: 提交**

```bash
git add src/web/competency-eval-api.ts
git commit -m "fix(competency-eval): 确保 API import 无断链"
```

---

## Task 9: 检查测试文件

**Files:**
- Review: `tests/agent/competency-eval/daily-reports-for-eval.test.ts`
- Review: `tests/web/competency-eval.test.ts`

- [ ] **Step 1: 运行测试确认无 rubric 相关的断裂**

```bash
cd D:/manage_robot && npm test -- --grep "competency"
```

- [ ] **Step 2: 修复任何因删除 rubric 而失败的测试**

可能需要 Mock 新的 job-req 存储函数，或删除过时的 rubric 测试。

- [ ] **Step 3: 提交**

```bash
git add tests/
git commit -m "test(competency-eval): 更新测试以匹配 rubric 删除"
```

---

## Task 10: 端到端验证

- [ ] **Step 1: 启动应用**

确认无启动错误（import 断链会在启动时显式）。

- [ ] **Step 2: 手动测试流程**

1. 打开能力评估页 → 空状态正常显示
2. 不上传任何文档，直接问"评张三最近30天" → AI 正常返回（无 rubric）
3. 上传一个岗位要求文档 → 确认 banner 显示文件名
4. 再问一个问题 → AI 参考了岗位要求 context
5. 打开侧栏 → 会话正常保存和加载
6. 移动端 → 布局正常

- [ ] **Step 3: 提交最终变更**

```bash
git add -A && git commit -m "feat(competency-eval): 完成 rubric→自由分析重构"
```

---

## 顺序说明

**Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10**

原因：
- Task 1 修改 session store，是底层依赖
- Task 2 在 API 层删除 rubric / 新增 job-req
- Task 3 是工具链
- Task 4 是 agent turn，依赖 Task 3
- Task 5 是路由，依赖 Task 2/3/4
- Task 6 是 UI，依赖 Task 5 的路由
- Task 7 删除文件（所有引用清理完后）
- Task 8 收尾 import 断链
- Task 9 测试
- Task 10 手动验证
