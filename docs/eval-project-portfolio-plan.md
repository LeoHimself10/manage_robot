# Eval：大项目（Portfolio）双角色

> **矩阵 v3**：发版用 `npm run eval:release`；Portfolio 场景见下文。详见 [eval-matrix-v3.md](./eval-matrix-v3.md)。

## 身份

| 身份 | userId | 配置 |
|------|--------|------|
| 角色 B（基线） | `eval-mgr-baseline` | 仅在 `WORKBENCH_MANAGER_USER_IDS` |
| 角色 A（Portfolio） | `eval-mgr-portfolio` | manager + `WORKBENCH_PROJECT_PORTFOLIO_USER_IDS` |

Eval 启动时设置独立 `EVAL_DATA_DIR` 与 SQLite；角色 A 预置 OCT / 注册申报等项目行。

## 命令

```bash
npm run eval:portfolio-regression   # 角色 B：禁止 project 工具与追问项目
npm run eval:project-portfolio      # 角色 A：P1–P4 场景
npm run eval:portfolio-full        # L0 vitest + L2 spot + L3 chains（推荐发版）
npm run eval:portfolio-spot        # 10 单轮
npm run eval:portfolio-chains      # 3 链 11 turn
npm run eval:portfolio-suite        # 上两者 + eval:assignment-gate
```

单场景：`EVAL_PROJECT_FILTER=P2_create npm run eval:project-portfolio`

## 发版门禁

有 `QWEN_API_KEY` 时，Portfolio 功能合并后建议：

```text
npm test
npm run eval:portfolio-suite
npm run eval:wbs-manager   # 可选全量主管链
```
