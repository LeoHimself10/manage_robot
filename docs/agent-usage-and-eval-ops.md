# Agent 用量统计与 Eval 运维

## Eval 矩阵 v3

见 [eval-matrix-v3.md](./eval-matrix-v3.md)。

| 命令 | 用途 |
|------|------|
| `npm run eval:unit` | PR 门禁（Vitest，无 LLM） |
| `npm run eval:integration` | meeting-import mock 全链路 |
| `npx vitest run tests/agent/task-intake/ tests/web/task-intake.test.ts` | 任务快录入库（结构/归属/HTTP，无 LLM） |
| `npx vitest run tests/agent/v2/` | v2 编排器单元测试（turn-contract / graph / requirements / bulk-assign-repro） |
| `npm run dev:task-intake` | 本地浏览器测 task-intake（端口见 `ASSIGNMENT_WEB_PORT`，默认 8787） |
| `npm run eval:spot` | 单轮 LLM，`EVAL_TAG=assignment\|portfolio\|misc\|read-url\|roles\|all` |
| `npm run eval:chains` | 多轮链，`EVAL_CHAIN_GROUP=core\|portfolio\|cross\|all` |
| `npm run eval:release` | 发版/nightly 编排 |
| `npm run eval:compare` | 对比 eval 历史 |

> **v2 引擎 eval 注意**：v2 eval 复用相同 fixture chain，通过 `ORCHESTRATOR_ENGINE=v2` 环境变量控制。legacy 测试文件通过 `vi.stubEnv("ORCHESTRATOR_ENGINE", "legacy")` 隔离，避免相互干扰。

报告 schema：[eval-report-schema-v1.md](./eval-report-schema-v1.md)

历史文件：`data/eval-history/eval-runs.jsonl`（已在 `.gitignore` 的 `data/` 下）

## GitHub Actions

`.github/workflows/agent-eval.yml`：

- PR → `eval:unit`
- 每周 schedule / manual → `eval:release`（需 `QWEN_API_KEY` secret）

## 生产用量

### 数据表（SQLite，与 workbench 同库）

- `agent_turn_metrics` — 每轮 Agent 指标
- `agent_usage_daily` — 日聚合
- `eval_candidates` — 在线 eval 失败待晋升

### Ingest

```bash
# 从容器 stdout JSONL
cat /var/log/manage-robot.jsonl | npx tsx scripts/ingest-structured-logs.ts

# 或指定文件
npx tsx scripts/ingest-structured-logs.ts path/to/log.jsonl
```

### 周报 CLI

```bash
npx tsx scripts/agent-usage-report.ts --week=2026-06-01
# → data/usage-reports/usage-YYYY-MM-DD.{json,md}
```

### Admin UI

- 页面：`/workbench/admin/ops`（admin 登录）
- API：`GET /api/workbench/admin/ops-dashboard?week=&span=1`

### 在线 Eval

环境变量：

| 变量 | 默认 | 说明 |
|------|------|------|
| `AGENT_METRICS_ENABLED` | `1` | 关闭写入 |
| `ONLINE_EVAL_ENABLED` | `1` | 关闭采样评分 |
| `ONLINE_EVAL_SAMPLE_RATE` | `0.05` | 随机采样率 |
| `ONLINE_EVAL_ALWAYS_ON_EVENTS` | `1` | 异常 100% 评分 |
| `ONLINE_JUDGE_ENABLED` | `1` | 关闭 LLM Judge |
| `ONLINE_JUDGE_MODEL` | `qwen-doc-turbo` | Judge 模型 |
| `ONLINE_JUDGE_TIMEOUT_MS` | `8000` | Judge 超时 |
| `ONLINE_JUDGE_MAX_TOKENS` | `600` | Judge 输出 token 上限 |
| `ONLINE_EVAL_LOOP_MS_WARN` | `120000` | 慢轮次 efficiency 警告 |

Judge 与规则层同批抽样（`sampled=true` 时运行）。校准：`npm run eval:judge-calibrate`（需 `QWEN_API_KEY`）。

### Admin+主管双角色

同一 `userId` 须同时在 **`WORKBENCH_ADMIN_USER_IDS`（env）** 与 **主管名单**（`WORKBENCH_MANAGER_USER_IDS` / `WORKBENCH_MANAGER_IDS_FILE` / 动态 `data/workbench-managers.json`）：

- 工作台：`primaryRole=admin`、`alsoManager=true`；**免登默认主管视图**（`defaultLoginViewRole`）；侧栏可切 Admin / 主管 / 员工；可访问 `/workbench/admin/ops` 与 **权限中心** `/workbench/admin/permissions`
- 钉钉 Agent（`DINGTALK_ROLE_ROUTING_ENABLED=1`）：`admin_also_manager` → **`toolProfile=manager`**（日常发任务/改派）
- Admin 白名单仅能通过 env 修改并 **重建容器**；主管/Portfolio 可通过权限中心 UI 或 Agent `set_manager_permission` 写动态 JSON

### SLO 告警

```bash
npx tsx scripts/agent-quality-alert.ts --date=2026-06-01
```

阈值：`SLO_MAX_TURNS_RATE_MAX`（默认 0.02）、`SLO_P90_LOOP_MS_MAX`（默认 120000）、`SLO_QUALITY_FAIL_RATE_MAX`（默认 0.15）、`SLO_JUDGE_FAIL_RATE_MAX`（默认 0.10）

### Error Feed → Fixture

```bash
npx tsx scripts/promote-eval-candidate.ts --traceId=<uuid>
# → fixtures/eval-v3/promoted/promoted_<id>.json
```

## ECS cron 建议（每日）

```bash
ingest-structured-logs → agent-usage-report → eval:release → agent-quality-alert
```

（具体 crontab 按部署路径调整）
