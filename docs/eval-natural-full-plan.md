# 自然语言全场景 Eval 计划（v2）

> **矩阵 v3**：发版请用 `npm run eval:release`；本文件保留场景矩阵说明。见 [eval-matrix-v3.md](./eval-matrix-v3.md)。

## 目标

在 **fileNotes 方案 A + read_url + prompt v5.23.13** 上线后回归，用**真实主管话术**（不含工具名、内部 id）覆盖主链路，并以**话术质量**为硬门槛——仅「调了工具」不算通过。Eval 环境与 ECS 现网对齐见 `scripts/eval-production-parity-env.ts`（`DINGTALK_ORCHESTRATOR_MAX_ITERATIONS=30` 等）。

## 设计原则

| 原则 | 实现 |
|------|------|
| 模拟真实用户 | 用户 turn 经 `assertNaturalUserMessage`；禁止 bulk_assign / taskId 等 |
| 多轮会话 | JSON fixture 链式 turn，**每链独立 SQLite/employee 目录**（防通讯录污染） |
| 高标准话术 | `assertAssistantMessageQuality`：禁工具名、禁 eval userId；**口播 `task_N` 默认允许**（仅 `forbidTaskIdLiterals` 时 FAIL） |
| 结构 + 语义 | assignment 覆盖率、假指派、max_turns；花名册链加 fileNotes 覆盖率 |
| 混合工具 | `chain_url_mixed`：`read_url` + DRAFT + 钉钉文档引导 + localhost + 花名册指派 |

## 场景矩阵（6 条链 · 共 28 turn）

| 链 ID | 场景 | Turn 数 | 关键断言 |
|-------|------|---------|----------|
| `chain_oct_wbs` | OCT 客诉：问题 → **WBS 扩 5 条** → 出表不发布 | 3 | O2 禁止 publish；≥5 tasks；O3 不发布 |
| `chain_url_mixed` | 外链背景 → DRAFT → 钉钉文档/内网 URL → 花名册指派 | 5 | read_url；读失败引导；禁止编造；全量指派 |
| `chain_roster10` | 10 人花名册：草案 → 上传 → 按技能分派 | 3 | read→resolve→pool；fileNotes≥50%；全量指派 |
| `chain_transport` | 临床运输 9 轮（自然语言 replay） | 9 | 拆分/重派/发布全链 |
| `chain_roster15` | 15 人 CAPA：草案 → 大名单 → 12+ 子任务技能指派 | 4 | ≥12 tasks；15 人池；≥8 人参与指派 |
| `chain_gate_extras` | 点将后：拆任务2、改截止改人、发布预览确认 | 4 | 与 assignment-gate A4/A5/M1/M2 等价 |

## 通过标准（任一失败即 FAIL）

1. **用户话术**：不含内部工具/字段名  
2. **助手话术**：不含工具函数名、`eval-*` userId、`fileNotes`/`selfProfile` 等内部 token  
3. **结构**：assignment 覆盖率、无假指派、无 max_turns、禁止误发布  
4. **花名册**：`candidatePool.entries[*].fileNotes` 非空比例 ≥ 阈值（链级配置，通常 50%–60%）  
5. **15 人链**：指派负责人 distinct ≥ 8 且均在 `people` 映射内  

## 运行方式

```bash
# 全量（assignment-gate vitest + read_url 单测 + 6 链 LLM，约 12–20 分钟 LLM 段）
npm run eval:natural-full

# 仅 28 turn 链
npm run eval:natural-full-chains

# 单链
EVAL_NATURAL_FILTER=chain_url_mixed npm run eval:natural-full-chains
```

输出：`.eval-natural-full/eval-summary.json`

## 跑分记录

### v1 首次（2026-05-25 · v5.23.11 · 5 链 22 turn · max_iterations=12）

| 阶段 | 结果 |
|------|------|
| `eval:assignment-gate` | **7/7** |
| `eval:natural-full-chains` | **11/22** |

主要问题：链间 SQLite 污染、O2 误发布、口播 `task_N` 断言过严、max_turns。

### v2 现网 parity（2026-05-25 · v5.23.13 · 6 链 28 turn · max_iterations=30）

| 阶段 | 结果 |
|------|------|
| `eval:assignment-gate` | **7/7** |
| `eval:natural-full-chains` | **26/28** |

| 链 | PASS | 备注 |
|----|------|------|
| `chain_oct_wbs` | 3/3 | O2 拆 turn 后扩 WBS 不发布 ✅ |
| `chain_url_mixed` | 4/5 | U4 偶发口播 `` `add_draft_subtask` ``（M-14） |
| `chain_roster10` | 3/3 | — |
| `chain_transport` | 9/9 | per-chain 隔离后全绿 |
| `chain_roster15` | 4/4 | — |
| `chain_gate_extras` | 4/4 | 拆分后补指派 + preview + publish ✅ |

剩余 2 turn 失败聚类：
1. **O2**（偶发）：仅输出 draft JSON、`message` 为空 → fixture 设 `assistantMinLength: 0`，以 task 条数为准  
2. **U4**：内网 URL 引导正确，但回复泄露工具名 → prompt 纪律（见 `docs/已知遗留问题-backlog.md` M-14）

## 与现有 eval 关系

- `eval:assignment-gate`：L2 点将门禁 → natural-full 首步仍跑 vitest + 脚本  
- `eval:read-url`：read_url 专项（I/R/M 场景）；natural-full 含 `chain_url_mixed` 混合回归  
- `eval:replay-transport`：逻辑并入 `chain_transport`  
- `eval:wbs-manager`：不整包重跑；OCT/CAPA 由 `chain_oct_wbs` / `chain_roster15` 覆盖  
