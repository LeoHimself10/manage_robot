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
- **`QWEN_STREAM`**：默认为 **开启**（OpenAI 兼容 **SSE**，服务端拼装完整 `content` 后再 `JSON.parse`）。设为 **`0` / `false` / `no`** 时使用单次整包响应。钉钉侧 **`DINGTALK_STREAM_PROGRESS`** 与 **`DINGTALK_QUICK_ACK`** 默认为 **关**，只推最终一条模型结果；需进度或「处理中」气泡时显式设 `1`。

本地可将变量写在项目根目录 `**.env`**，CLI 已 `import "dotenv/config"` 自动加载。可参考 `.env.example`。

> 注意：空字符串环境变量会按“未设置”处理，避免 `QWEN_MODEL=` 覆盖默认模型导致 DashScope 返回 `you must provide a model parameter`。

## 3. 调用链路

1. `checkInputQuality`：空文本等基础护栏；**超长输入**（`INPUT_MAX_CHARS`，见 `.env.example`）则不进入模型、`canGenerateWbs: false`，以追问提示分段。**不静默截断**用户原文。
2. **必须传入** `llmPlanner`（通常 `runQwenPlanner`）；否则 `GENERATION_FAILED`。
3. `runQwenPlanner`：**薄封装**，返回 `rawJson` + `trace`；结构与域校验、`traceId` 贯穿、可选 **一轮结构自纠正**（`correction`）均在 `createTaskPlanningDemo`。默认 HTTP **流式（SSE）** 接收、整段 JSON 齐后再解析；可通过 `QWEN_STREAM=0` 关掉。
4. **prompt v2.8**：对寒暄/无关输入要求 **LOW + `clarificationUx=NON_TASK`**，`openQuestions` 内用**本机器人**主语与**您**引导用户发送**可多句**的任务背景（勿用语义上的「只允许一句」）；避免「关于您的问题」类套话起句；追问进 `openQuestions`，钉钉侧**不**自动加列表符号或固定引导句。
5. 可选 **`sessionDigest`**：由上轮会话摘要拼装，写入 Qwen **user prompt**（钉钉侧注入），不改变 `background` 原文（便于审计对齐）。
6. Qwen 根据版本化 prompt 输出分类、追问、任务包、质量域 CAPA 建议与 `gateSelfCheck`；信息不足时输出低置信度与 `openQuestions`，pipeline 返回 `NEEDS_MORE_INFO`。
7. `validateLlmPlanPayload`：做结构与域约束校验；质量域必须包含 `capaAdvisory`，研发域不得包含 `capaAdvisory`。
8. `validateDemoGate` + **一致性检查**（`consistency.ts`）：硬门禁与 `dependencyTaskIds` / 环 / 日期先后等 **warnings** 合并进 `DemoGateResult.warnings`，Markdown 底部展示。
9. `DRAFT_READY`：渲染后对 Markdown 做 **PII 正则脱敏**（手机号、身份证、IPv4），可用 `CONTENT_FILTER_DISABLED=1` 关闭（见部署文档）。
10. 失败：`GENERATION_FAILED` + `trace.errorCode`；成功或门禁未通过均输出 Markdown、**`DemoGenerationMetadata`**（`timings`、`traces[]` 等）及 **Demo JSONL 审计行**（若未禁用）。

## 4. 风险控制

- Token 与超时：模型策略统一裁剪。
- 重试：`QWEN_MAX_RETRIES`（HTTP 层可带退避，见 `qwen-compatible-client`）。
- 可观测：每次 planner 调用 `InferenceTrace`；`createTaskPlanningDemo` 汇总 **`traces[]`**、**分段 `timings`**；成功草案可打 **`logStructured`** JSON 行。
- 审计：`requestId/model/tokens/latency/errorCode`；另见 **Demo JSONL**（`AUDIT_DEMO_JSONL_PATH`）与 Harness **`AUDIT_SINK=file`**（部署文档）。
- 密钥轮换：泄露须即刻在控制台作废 Key。

## 5. 评测方式

`npm run demo:eval` 输出：

- `draftReadyCases` / `needsMoreInfoCases` / `generationFailedCases`
- `avgTotalTokens` / `p95LatencyMs`

`npm run demo:scenarios` 会运行 **十余个**端到端冒烟场景（质量 / 研发 / 信息不足 / 更长现实描述等），打印每场景 JSON 摘要与最终 **`summary.tallies`**。单次运行耗时可数分钟量级，需在 `.env` 配置有效 `QWEN_API_KEY`。

## 6. 分期落地

- P0：仅 LLM 主路径 + 规则校验 + 严模式失败语义。（已具备）
- P1：**Trace / 分段耗时 / JSONL 审计 / 会话与限速 / Plan 快照 / PII 脱敏 / 一致性 warnings**。（工程已落地，见 `docs/harness-next-optimizations.md`）
- P2：黄金样本回归集与模板/提示词版本治理（持续）。

