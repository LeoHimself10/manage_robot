# 自然语言全场景 Eval 计划（v1）

## 目标

在 **fileNotes 方案 A（prompt v5.23.11）** 上线前/后回归，用**真实主管话术**（不含工具名、内部 id）覆盖主链路，并以**话术质量**为硬门槛——仅「调了工具」不算通过。

## 设计原则

| 原则 | 实现 |
|------|------|
| 模拟真实用户 | 用户 turn 经 `assertNaturalUserMessage`；禁止 bulk_assign / taskId 等 |
| 多轮会话 | JSON fixture 链式 turn，同一 `sessionKey` 内状态延续 |
| 高标准话术 | `assertAssistantMessageQuality` 检查助手回复：禁工具名、禁 task_x、禁 userId、禁内部 token |
| 结构 + 语义 | 保留 assignment 覆盖率、假指派、max_turns；花名册链加 fileNotes 覆盖率 |
| 复杂场景 | 15 人名单 × 12 条子任务，要求全量指派且 assignee 均来自候选池 |

## 场景矩阵（5 条链 · 共 28 turn）

| 链 ID | 场景 | Turn 数 | 关键断言 |
|-------|------|---------|----------|
| `chain_oct_wbs` | OCT 客诉：问题 → 补型号批次截止 → WBS 草案 | 2 | ≥5 tasks；助手四段式、无 CLARIFY 混 draft |
| `chain_roster10` | 10 人花名册：先有草案 → 上传名单 → 按技能分派 | 3 | read→resolve→pool；fileNotes≥60%；全量指派；话术质量 |
| `chain_transport` | 临床运输 9 轮（复用 replay-transport） | 9 | 拆分/重派/发布全链 |
| `chain_roster15` | 15 人 CAPA：草案 → 上传大名单 → 按部门技能派 12 条 | 4 | ≥12 tasks；15 人池；≥8 人参与指派；fileNotes |
| `chain_gate_extras` | 点将后：拆任务2、改截止改人、发布预览确认 | 4 | 与 assignment-gate A4/A5/M1/M2 等价 |

## 通过标准（任一失败即 FAIL）

1. **用户话术**：不含内部工具/字段名  
2. **助手话术**：不含工具名、`task_\d+`、`eval-*` userId、`fileNotes`/`selfProfile` 等  
3. **结构**：assignment 覆盖率、无假指派、无 max_turns、禁止 >4 次单行 patch 循环  
4. **花名册**：`candidatePool.entries[*].fileNotes` 非空比例 ≥ 60%（软目标，低于则 WARN 记 fail 若 `requireFileNotes`）  
5. **15 人链**：指派负责人 distinct ≥ 8 且均在 `people` 映射内  

## 运行方式

```bash
# 全量（含 assignment-gate 单测 + 5 链 LLM，约 25–40 分钟）
npm run eval:natural-full

# 单链
EVAL_NATURAL_FILTER=chain_roster15 npm run eval:natural-full-chains
```

输出：`.eval-natural-full/eval-summary.json`

## 首次全量跑分（2026-05-25 · v5.23.11）

| 阶段 | 结果 |
|------|------|
| `eval:assignment-gate`（vitest + L2 7 turn） | **7/7 PASS** |
| `eval:natural-full-chains`（5 链 22 turn） | **11/22 PASS** |
| **`npm run eval:natural-full` 合计** | **FAIL**（话术/行为门槛未达标） |

### 分链摘要

| 链 | PASS | 主要失败原因 |
|----|------|--------------|
| `chain_oct_wbs` | 1/2 | O2 误走发布（4 条未扩到 ≥5 WBS） |
| `chain_roster10` | 3/3 | — |
| `chain_transport` | 4/9 | 链间通讯录污染（已修 per-chain SQLite）；口播 `task_N` |
| `chain_roster15` | 2/4 | max_turns；15 人池只派 5 人；口播 `fileNotes` |
| `chain_gate_extras` | 1/4 | 拆分/预览口播 `task_N`（结构动作多数成功） |

### 失败聚类（改进 backlog）

1. **用户可见话术**：回复中出现 `task_1` / `task_N` 字面 id（8 turn）— prompt 需强化「用任务序号或标题，禁 task_x」
2. **内部字段泄露**：口播 `fileNotes`（1 turn）
3. **编排轮次**：复杂 turn 打满 12 iteration 未出 JSON（2 turn）
4. **15 人复杂指派**：distinct assignees 5&lt;8（模型只从部分池成员选人）
5. **意图误判**：「出正式任务表」被当成发布确认（O2）

## 与现有 eval 关系

- `eval:assignment-gate`：L2 点将门禁（7 turn 单会话）→ **natural-full 首步仍跑其 vitest + 脚本**  
- `eval:replay-transport`：并入 `chain_transport`  
- `eval:wbs-manager`：不整包重跑（耗时长）；OCT/ CAPA 草案由 `chain_oct_wbs` / `chain_roster15` 覆盖  
