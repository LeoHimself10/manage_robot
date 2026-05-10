# Harness 继续优化建议（归档 + 进度）

**位置**：原为仓库根目录草案，现收于 `docs/` 与代码变更同步维护。  
**状态摘要（2026-05-10）**：下文 P0/P1/P2/P3 清单主体已在 `main` 落地。此外：
- **ReAct Agent v4.0**：`runOrchestrator` 替换 `createTaskPlanningDemo`，二阶段 prompt（追问/出稿），6 tool function calling
- **指派推荐 v0.2 MVP**：async + search_employees + signed URL + mock 卡片
- **短期记忆**：knownFacts[] 模型自主维护
- **长期记忆**：embedding + cosine 文件遍历
- **模型**：`qwen3.6-plus`（默认），支持 function calling，thinking 默认关
- 多副本 Redis、OA 闭环等仍为长期项。

## 当前状态（评分表仍为历史快照，仅供参考）

经过多轮重构，pipeline 层结构性债务已基本清完：

| 维度     | 历史自评 |
| -------- | ------- |
| 规划能力 | 6.0     |
| 执行与编排 | 5.0   |
| 验证与门禁 | 7.5   |
| 记忆与状态 | 2.5→已增强（会话 TTL + Plan 快照 + 审计落盘） |
| 安全与对齐 | 3.5→已增强（输入长度、限速、PII 脱敏） |
| 代码质量 | 8.0     |

---

## P0：记忆与状态

### ✅ P0-1：会话级短期记忆（已落地）

- `src/infra/session-store.ts`：内存 TTL、同会话速率窗口（见 `RATE_LIMIT_WINDOW_MS`）。
- `src/dingtalk-bot.ts`：合成 session key，`sessionDigest` 经 `session-digest` 拼装后传入 `createTaskPlanningDemo`。
- `src/agent/demo/qwen-prompt.ts`：可选「上轮上下文」段注入模型 user prompt。
- **部署**：多 ECS 副本需后续 Redis；当前与 `AGENTS.md` 假设一致：**单实例进程内存**。

### ✅ P0-2：审计持久化（已落地）

- **Demo 主链路**：`createTaskPlanningDemo` 每次完结追加一行 **`AUDIT_DEMO_JSONL_PATH`**（默认 `./data/demo-runs.jsonl`）；钉钉仅走 pipeline，此轨为线上可观测主体。
- **Harness 编排**：`AUDIT_SINK=file` + `AUDIT_JSONL_PATH` → `src/infra/audit-file-sink.ts` 实现 `AuditSink`。

### ✅ P0-3：Plan 快照存储（已落地）

- `src/infra/plan-store.ts`，`DRAFT_READY` 时以 `traceId` 为 id 写入 `PLAN_STORE_DIR`。
- **`GET /plans/:id`** 仍属可选延后；测试可用 `PLAN_SNAPSHOT_DISABLED=1` 跳过写盘。

---

## P1：安全与对齐

### ✅ P1-1：输入长度限制（已落地）

- `INPUT_MAX_CHARS`（默认 3000）在 **`checkInputQuality`** 中校验；**超长不静默截断**，而是阻断 WBS 生成并追问分段/缩短（与「不缺信息不瞎生成」口径一致）。

### ✅ P1-2：输出合规过滤（已落地，范围收窄）

- `src/infra/content-filter.ts`：**手机号 / 18 位身份证 / IPv4** 正则替换为 `[已脱敏]`。
- **未实现**内置「政治词汇」黑名单；亦不推荐在仓库固化此类列表。

### ✅ P1-3：轮次 / 频率限制（已落地）

- 与会话 store 共用；钉钉侧命中窗口返回「请稍后再试」类提示（详见 `session-store`、`dingtalk-bot`）。

---

## P2：执行与编排

### ✅ P2-1：结构化日志与 trace 入账（已落地）

- `src/infra/logger.ts`：`logStructured` 单行 JSON。
- `DemoGenerationMetadata.traces[]`：每次成功 `llmPlanner` 调用一条 `InferenceTrace`（含纠错第二跳）。

### ✅ P2-2：Pipeline 耗时分段（已落地）

- `DemoGenerationTimings`：`plannerMs`（可含多跳累计）、`coerceMs`、`validateMs`、`gateMs`、`renderMs`。

---

## P3：验证与门禁

### ✅ P3-1：逻辑自洽校验（已落地）

- `src/agent/demo/consistency.ts`：依赖存在性、环检测、ISO8601 或可解析区间的日期先后对比（其余跳过）。
- 结果以 **warnings** 合入门禁展示，默认不Hard 挡成功路径（见实现细节）。

### ✅ P3-2：低质量标记上浮（已落地）

- `DemoGateResult.warnings`；自检与硬门禁对齐字段时追加说明。
- Markdown：门禁未过时任务行前 `⚠`、底部「一致性与自检提示」段。

---

## 实施优先级汇总（历史工作量表）

| 优先级 | 编号   | 改动           | 状态（2026-05-08） |
| ------ | ------ | -------------- | ------------------ |
| P0     | P0-1   | 会话短期记忆   | ✅                 |
| P0     | P0-2   | 审计持久化     | ✅                 |
| P0     | P0-3   | Plan 快照      | ✅                 |
| P1     | P1-1   | 输入长度       | ✅                 |
| P1     | P1-2   | 输出过滤       | ✅（PII 正则）      |
| P1     | P1-3   | 频率限制       | ✅                 |
| P2     | P2-1   | 结构化日志     | ✅                 |
| P2     | P2-2   | 耗时分段       | ✅                 |
| P3     | P3-1   | 逻辑自洽       | ✅                 |
| P3     | P3-2   | 低质量标记     | ✅                 |

---

## 不在此次范围的长期事项

- 多工具注册表与 function calling 级 Planner
- HR 人岗推荐集成（外部 API）
- 定时提醒与升级调度（cron / job queue）
- 钉钉卡片承接三态、验收闭环
- 向量数据库长期记忆（embedding +）
