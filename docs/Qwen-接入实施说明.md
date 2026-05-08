# Qwen 接入实施说明（DashScope Compatible）

## 1. 接入目标

- 任务拆解草案**仅由大模型生成**；已删除基于关键词的分类、规则 CAPA、模板 WBS 等实现。
- **规则层**仅用于：空输入等基础护栏、输出 Schema 校验、派发门禁二次确认、（必要时）兼容层字段归一化——用于**约束 AI 输出**，不替代模型生成内容，也不为核心业务字段填充语义默认值。
- 模型调用失败或校验失败时返回 `GENERATION_FAILED`，**不回退规则稿**。
- **命令行**（`npm run demo` / `npm run demo:eval` / `npm run demo:scenarios`）必须配置 `QWEN_API_KEY`（可用项目根目录 `.env`，已被 git 忽略）。

## 2. 运行配置

必须配置：

- `QWEN_API_KEY`：环境变量或 `.env`，**禁止**提交仓库。

可选配置（均有默认值）：

- `QWEN_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `QWEN_MODEL`：默认 `qwen-plus`；当前 ECS 冒烟测试已验证 `qwen3.6-plus` 可用
- `QWEN_TEMPERATURE`：默认 `0.2`
- `QWEN_MAX_TOKENS`：默认 `2500`
- `QWEN_TIMEOUT_MS`：默认 `20000`
- `QWEN_MAX_RETRIES`：默认 `1`
- `QWEN_REQUEST_BUDGET_TOKENS`：默认 `12000`

本地可将变量写在项目根目录 `**.env`**，CLI 已 `import "dotenv/config"` 自动加载。可参考 `.env.example`。

> 注意：空字符串环境变量会按“未设置”处理，避免 `QWEN_MODEL=` 覆盖默认模型导致 DashScope 返回 `you must provide a model parameter`。

## 3. 调用链路

1. `checkInputQuality`：仅做空输入等基础护栏；非空输入进入模型做语义充分性判断。
2. **必须传入** `llmPlanner`（通常 `runQwenPlanner`）；否则 `GENERATION_FAILED`。
3. Qwen 根据版本化 prompt 输出分类、追问、任务包、质量域 CAPA 建议与 `gateSelfCheck`；信息不足时输出低置信度与 `openQuestions`，pipeline 返回 `NEEDS_MORE_INFO`。
4. `validateLlmPlanPayload`：做结构与域约束校验；质量域必须包含 `capaAdvisory`，研发域不得包含 `capaAdvisory`。
5. `validateDemoGate`：对交付物、完成标准、截止时间、反馈频率做代码二次硬校验，并与模型自检结果保持一致。
6. 失败：`GENERATION_FAILED` + `trace.errorCode`；成功或门禁未通过草案输出 Markdown 与 trace。

## 4. 风险控制

- Token 与超时：模型策略统一裁剪。
- 重试：`QWEN_MAX_RETRIES`。
- 审计：`requestId/model/tokens/latency/errorCode`（错误路径）。
- 密钥轮换：泄露须即刻在控制台作废 Key。

## 5. 评测方式

`npm run demo:eval` 输出：

- `draftReadyCases` / `needsMoreInfoCases` / `generationFailedCases`
- `avgTotalTokens` / `p95LatencyMs`

`npm run demo:scenarios` 会运行 6 个云端/本地冒烟场景（质量、研发、信息不足分支），输出每个场景的状态、分类、任务数量、token 与时延摘要。

## 6. 分期落地

- P0：仅 LLM 主路径 + 规则校验 + 严模式失败语义。
- P1：Trace 成本与时延观测、预算阈值。
- P2：黄金样本回归与模板/提示词版本治理。

