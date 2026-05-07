# Qwen 接入实施说明（DashScope Compatible）

## 1. 接入目标

- 任务拆解草案**仅由大模型生成**；已删除基于关键词的分类、规则 CAPA、模板 WBS 等实现。
- **规则层**仅用于：输入质检、输出 Schema 校验、派发门禁、（必要时）兼容层字段归一化——用于**约束 AI 输出**，不替代模型生成内容。
- 模型调用失败或校验失败时返回 `GENERATION_FAILED`，**不回退规则稿**。
- **命令行**（`npm run demo` / `npm run demo:eval`）必须配置 `QWEN_API_KEY`（可用项目根目录 `.env`，已被 git 忽略）。

## 2. 运行配置

必须配置：

- `QWEN_API_KEY`：环境变量或 `.env`，**禁止**提交仓库。

可选配置（均有默认值）：

- `QWEN_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `QWEN_MODEL`：默认 `qwen-plus`
- `QWEN_TEMPERATURE`：默认 `0.2`
- `QWEN_MAX_TOKENS`：默认 `2500`
- `QWEN_TIMEOUT_MS`：默认 `20000`
- `QWEN_MAX_RETRIES`：默认 `1`
- `QWEN_REQUEST_BUDGET_TOKENS`：默认 `12000`

本地可将变量写在项目根目录 `**.env`**，CLI 已 `import "dotenv/config"` 自动加载。可参考 `.env.example`。

## 3. 调用链路

1. `checkInputQuality`：输入质检，不通过则 `NEEDS_MORE_INFO`。
2. **必须传入** `llmPlanner`（通常 `runQwenPlanner`）；否则 `GENERATION_FAILED`。
3. `validateLlmPlanPayload`：质量域必须包含 `capaAdvisory`；研发域不得包含 `capaAdvisory`。
4. 失败：`GENERATION_FAILED` + `trace.errorCode`。
5. `validateDemoGate`：门禁校验。
6. 输出 Markdown 与 trace。

## 4. 风险控制

- Token 与超时：模型策略统一裁剪。
- 重试：`QWEN_MAX_RETRIES`。
- 审计：`requestId/model/tokens/latency/errorCode`（错误路径）。
- 密钥轮换：泄露须即刻在控制台作废 Key。

## 5. 评测方式

`npm run demo:eval` 输出：

- `draftReadyCases` / `needsMoreInfoCases` / `generationFailedCases`
- `avgTotalTokens` / `p95LatencyMs`

## 6. 分期落地

- P0：仅 LLM 主路径 + 规则校验 + 严模式失败语义。
- P1：Trace 成本与时延观测、预算阈值。
- P2：黄金样本回归与模板/提示词版本治理。

