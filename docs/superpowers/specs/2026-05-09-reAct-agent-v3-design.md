# ReAct Agent v3 架构设计

> **历史文档快照**：本文记录特定阶段的设计草案，**可能与当前 `main` 代码不一致**。请以仓库根目录 [`AGENTS.md`](../../../AGENTS.md)、[`docs/Qwen-接入实施说明.md`](../../Qwen-接入实施说明.md)、[`docs/deploy-aliyun-dingtalk.md`](../../deploy-aliyun-dingtalk.md) 为准；本目录说明见 [`README.md`](../README.md)。

**文档日期**：2026-05-09
**修订人**：Leo + Claude
**状态**：草案
**依赖**：v2.11 conversational intent + v0.2 assignment 已落地

## 1. 目标

把当前"六态意图状态机 + 单轮工具调用"升级为 **Thin ReAct Loop**：
- 模型自由决定每一步做什么（追问、查资料、出草案、指派人）
- 代码只做：执行工具 + 护栏校验 + 循环上限
- 短期记忆由模型自主维护（`update_known_facts` / `list_known_facts`）
- 长期记忆通过 embedding + 文件遍历检索历史 plan

## 2. 核心架构

```
钉钉消息
  │
  ▼
ReAct Loop（src/agent/orchestrator.ts，最多 6 轮）
  │
  ├─ 模型推理 → stopReason?
  │    │
  │    ├─ "tool_use"
  │    │    → 代码执行工具
  │    │    → 结果追加回 messages
  │    │    → 下一轮
  │    │
  │    └─ "end_turn"
  │         → message（用户可见）
  │         → 可选 draft（tasks + classification + gateSelfCheck）
  │         → 可选 assignments（候选人推荐）
  │
  ▼
代码护栏层（不变量）
  ├─ 白名单校验
  ├─ gate 四必填硬校验（若出草案）
  ├─ PII 脱敏
  └─ 审计写盘
  │
  ▼
钉钉推送
```

## 3. 记忆架构

### 3.1 短期记忆：模型自主维护

新增工具 `update_known_facts` / `list_known_facts`，模型在对话中主动调用：

- `update_known_facts({ facts: string[] })` → 写入 session-store 的 `knownFacts[]`
- `list_known_facts()` → 返回当前 session 已记录的全部事实

代码不做任何事实提取或自动摘要——只提供读写接口，由模型决定记什么、什么时候记。

### 3.2 长期记忆：embedding + 文件检索

- `save_draft` 成功后自动调用 DashScope embedding API 生成向量，存为 `<traceId>.embedding.json`
- 新增工具 `search_similar_plans(query, topK)`：遍历现有 plan 快照，算 cosine 相似度，返回 top K
- 不引入向量数据库。当 plan 数量 > 1000 时迁 sqlite-vec

## 4. Prompt v3.0

从 v2.11 的 ~45 行精简为 ~25 行。删除所有"六态分流"约束。替换为：

- 角色定义
- 自由工作方式声明
- 两条硬边界（gate 四必填 + 人选来源真实）
- 工具列表
- 输出结构规范

完整 prompt 见实施计划。

## 5. 工具集

| 工具 | 用途 | 实现 |
|------|------|------|
| `search_employees` | 按 domain/skills/department 搜候选人 | 已有 |
| `search_web` | 搜索技术方案、类似案例 | DashScope 联网搜索 API |
| `search_similar_plans` | 查历史类似任务 | embedding + cosine 文件遍历 |
| `update_known_facts` | 记录用户已说的事实 | session-store knownFacts[] |
| `list_known_facts` | 查看已记录的全部事实 | session-store knownFacts[] |
| `save_draft` | 保存草案 + 触发 gate 校验 | 现有 coerce/validate/gate 链路 |

## 6. 改动范围

| 类型 | 文件 | 说明 |
|------|------|------|
| 新增 | `src/agent/orchestrator.ts` | ReAct loop 主循环 |
| 新增 | `src/agent/tools/` | 6 个工具定义 + handler |
| 新增 | `src/infra/plan-index.ts` | embedding 生成 + 文件遍历检索 |
| 重写 | `src/agent/demo/qwen-prompt.ts` | v2.11 → v3.0 |
| 改造 | `qwen-compatible-client.ts` | callWithTools 移除 maxIterations=1 |
| 精简 | `src/agent/demo/pipeline.ts` | 删除六态分流，保留 coerce/validate/gate/render |
| 扩展 | `session-store.ts` | 加 knownFacts[] |
| 不变 | gate.ts, llm-schema.ts, content-filter.ts, audit-*.ts | 护栏层 |

## 7. 验收标准

- [ ] 模型可以在同一对话中从 CLARIFY 直接跳到 DRAFT（不被代码状态机阻止）
- [ ] 模型可以在 DRAFT 中途发现信息不足、折返追问
- [ ] 模型调用 `update_known_facts` 后，`list_known_facts` 返回正确的已知事实
- [ ] OCT U 盘场景：模型不会重复追问已有答案的问题
- [ ] `search_similar_plans` 返回的历史案例与查询语义相关
- [ ] gate 四必填仍作为硬边界生效
- [ ] 白名单校验仍生效
- [ ] 全量测试通过 + tsc 零错误

## 8. 不在此范围

- 多 Agent 协作（Plan-Execute 双 Agent 等）
- 钉钉互动卡片真实调用（权限到位后再切）
- 向量数据库（plan 数量 > 1000 前不引入）
- 员工档案在线编辑界面
