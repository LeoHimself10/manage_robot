# Harness 继续优化建议（归档 + 进度）

**位置**：原为仓库根目录草案，现收于 `docs/` 与代码变更同步维护。  
**状态摘要（2026-05-25）**：下文 P0/P1/P2/P3 清单主体已在 `main` 落地。此外：
- **ReAct Agent v5.23.13**：`runOrchestrator` 为钉钉主链路，`qwen-prompt.ts` 单一提示词来源（planner / employee profile；主管共用 planner + FOLLOWUP）
- **`read_url`**：公网链接读取 + SSRF guard；钉钉 richText 入站统一 `extractDingtalkMessageText`
- **花名册 fileNotes（Scheme A）**：候选池技能摘要注入 memory + ASSIGN 优先 fileNotes
- **natural-full eval**：28 turn 自然语言回归 + `eval-production-parity-env` 对齐 ECS
- **指派推荐 v0.2 MVP**：orchestrator 同请求内 `assignment` JSON + signed Web 工作台
- **短期记忆**：knownFacts[] 模型自主维护；有草案时注入完整 latestDraft
- **长期记忆**：embedding + cosine 文件遍历
- **催办 v1** / **每日进展推送 v1**：scheduler 与 `dingtalk-bot` 并列启动
- **模型**：`qwen3.6-plus`（默认），支持 function calling；钉钉链路默认 `DINGTALK_QWEN_THINKING=0`
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
- `src/dingtalk-bot.ts`：合成 session key，维护 `knownFacts + conversationHistory` 并传入 `runOrchestrator`。
- `src/agent/demo/qwen-prompt.ts`：可选「上轮上下文」段注入模型 user prompt。
- **部署**：多 ECS 副本需后续 Redis；当前与 `AGENTS.md` 假设一致：**单实例进程内存**。

### ✅ P0-2：审计持久化（已落地）

- **钉钉主链路**：`runOrchestrator` 的结构化日志 + `data/plans` 快照为线上可观测主体。
- **Demo 回归链路**：`createTaskPlanningDemo` 每次完结追加一行 **`AUDIT_DEMO_JSONL_PATH`**（默认 `./data/demo-runs.jsonl`）。
- **Harness 编排**：`AUDIT_SINK=file` + `AUDIT_JSONL_PATH` → `src/infra/audit-file-sink.ts` 实现 `AuditSink`。

### ✅ P0-3：Plan 快照存储（已落地）

- `src/infra/plan-store.ts`，`DRAFT_READY` 时以 `traceId` 为 id 写入 `PLAN_STORE_DIR`。
- **`GET /plans/:id`** 仍属可选延后；测试可用 `PLAN_SNAPSHOT_DISABLED=1` 跳过写盘。

---

## P1：安全与对齐

### ✅ P1-1：输入质量护栏（已调整）

- 当前主链路仅保留“空输入”硬拦截，去除按长度阻断模型调用的策略；优先把判断权交给模型。

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
| P1     | P1-1   | 输入质量护栏   | ✅（已去除长度硬拦截） |
| P1     | P1-2   | 输出过滤       | ✅（PII 正则）      |
| P1     | P1-3   | 频率限制       | ✅                 |
| P2     | P2-1   | 结构化日志     | ✅                 |
| P2     | P2-2   | 耗时分段       | ✅                 |
| P3     | P3-1   | 逻辑自洽       | ✅                 |
| P3     | P3-2   | 低质量标记     | ✅                 |

---

## 不在此次范围的长期事项

- 多工具注册表与 function calling 级 Planner（部分已通过 profile 分工具实现）
- HR 人岗推荐集成（外部 API）
- 钉钉卡片承接三态、验收闭环
- 向量数据库长期记忆（当前为文件 embedding + cosine）
