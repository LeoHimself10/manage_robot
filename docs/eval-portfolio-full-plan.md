# Eval：Portfolio 主管 Agent 完整评估（v1）

## 命令

```bash
# 完整套件（L0 vitest + L2 spot + L3 chains，需 QWEN_API_KEY）
npm run eval:portfolio-full

# 分层
npm run eval:portfolio-spot      # 10 单轮（3 基线 + 7 portfolio）
npm run eval:portfolio-chains    # 3 链 11 turn

# 过滤
EVAL_PORTFOLIO_FILTER=P4_switch npm run eval:portfolio-spot
EVAL_PORTFOLIO_FILTER=chain_pf_switch_publish npm run eval:portfolio-chains

# 快速冒烟（原有）
npm run eval:portfolio-suite
```

## 身份

| 角色 | userId | 说明 |
|------|--------|------|
| A（Portfolio） | `eval-mgr-portfolio` | `WORKBENCH_PROJECT_PORTFOLIO_USER_IDS` |
| B（基线） | `eval-mgr-baseline` | 仅 manager，不在 portfolio 名单 |

## 输出

- `.eval-portfolio-full/eval-summary.json` — 汇总
- `.eval-portfolio-full/eval-summary-spot.json` — 单轮明细
- `.eval-portfolio-full/eval-summary-chains.json` — 多链明细
- `.eval-portfolio-full/spot/*.json` — 每场景 artifact

## 场景

### L2 Spot（10）

| ID | 角色 | 要点 |
|----|------|------|
| B1 | B | 无项目工具 |
| B2 | B | 发布 project_id NULL |
| B3 | B | 含「专项」仍无项目工具 |
| P1 | A | OCT 明示 + 拆任务 |
| P1d | A | 别名「客诉」 |
| P2 | A | create_project |
| P3 | A | 发布绑定 OCT |
| P4 | A | 纠正归属，禁 start_new_task |
| P4b | A | 切换保留 draft 条数 |
| P5 | A | 已有 draft 补绑项目 |

### L3 Chains（11 turn）

| 链 | Turn | 要点 |
|----|------|------|
| chain_pf_oct_wbs | 3 | 归属 + WBS 扩条 + 不发布 |
| chain_pf_switch_publish | 5 | 点将 + 换项目 + 两回合发布 |
| chain_pf_no_project_ok | 3 | MVP 无 project_id 发布 |

## 发版建议

Portfolio prompt/工具变更后：

```text
npm test
npm run eval:portfolio-full
```
