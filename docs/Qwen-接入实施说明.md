# Qwen 接入实施说明（DashScope Compatible）

## 1. 接入目标

- 任务拆解草案**仅由大模型生成**；已删除基于关键词的分类、规则 CAPA、模板 WBS 等实现。
- 当前实现偏“模型优先”：规则层以稳定运行与最小结构归一化为主，尽量减少对模型行为的硬编码拦截。
- 模型调用失败或校验失败时返回 `GENERATION_FAILED`，**不回退规则稿**。
- **命令行**（`npm run demo` / `npm run demo:eval` / `npm run demo:scenarios`）必须配置 `QWEN_API_KEY`（可用项目根目录 `.env`，已被 git 忽略）。

## 2. 运行配置

必须配置：

- `QWEN_API_KEY`：环境变量或 `.env`，**禁止**提交仓库。

可选配置（均有默认值）：

- `QWEN_BASE_URL`：默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `QWEN_MODEL`：默认 `qwen3.6-plus`（支持 function calling + thinking）。ECS 已切换至 `qwen3.6-plus`
  > `qwen-turbo` 不支持 tool_calls 协议，不可用于 orchestrator 链路。
- `QWEN_TEMPERATURE`：默认 `0.2`
- `QWEN_MAX_TOKENS`：默认 `4000`
- `QWEN_TIMEOUT_MS`：默认 **`60000`** ms；限制在 `5000–120000` ms
- `QWEN_MAX_RETRIES`：默认 `1`
- `QWEN_REQUEST_BUDGET_TOKENS`：默认 `12000`
- **`QWEN_STREAM`**：默认为 **开启**（OpenAI 兼容 **SSE**，服务端拼装完整 `content` 后再 `JSON.parse`）。设为 **`0` / `false` / `no`** 时使用单次整包响应。钉钉机器人 **仅推送一条终稿 Markdown**，不在会话中发送「处理中」或流式进度类气泡（与 `QWEN_STREAM` 是否开启无关）。
- **`DEMO_LLM_CORRECTION`**：默认**开启**（未设置或 `1` / `true` / `yes`）。设为 **`0` / `false` / `no`** 时，`createTaskPlanningDemo` **不进行**校验失败后的第二轮自纠正（`enableLlmCorrection: false`）。该变量主要影响 CLI demo/eval/pipeline 路径，不是钉钉 `runOrchestrator` 主链路的关键开关。
- **`SESSION_DIGEST_MAX_CHARS`**：钉钉多轮会话里，上轮摘要注入 Qwen user prompt 的**最大字符数**（默认 `2000`，有效范围 `200`–`8000`；非法或未解析的数字回退默认）。仅影响**同会话第二轮及以后**的 prompt 体积，对首条消息无影响。

本地可将变量写在项目根目录 `**.env`**，CLI 已 `import "dotenv/config"` 自动加载。可参考 `.env.example`。

### 2.1 降低回复延迟（运维侧）

端到端时间主要由 **DashScope 单次生成**决定。在不改提示词的前提下可组合：

- 在控制台选用账号内 **偏延时/吞吐的模型**（通过 `QWEN_MODEL` 指定；需在目标环境做回归）。
- 在输出不被截断的前提下**略降** `QWEN_MAX_TOKENS`（例如 1800–2200），观察是否出现 JSON 截断。
- **`QWEN_MAX_RETRIES=0`**：只做一次 HTTP 请求，少退避等待；网络偶发错误时失败率可能上升。
- **`DEMO_LLM_CORRECTION=0`**：取消第二轮自纠正（见上文）。
- **`SESSION_DIGEST_MAX_CHARS`**：缩短多轮摘要，略减后续轮次的 prompt tokens。

MVP 试点可先使用“快速档”：`QWEN_MAX_RETRIES=0`、`DEMO_LLM_CORRECTION=0`、`QWEN_MAX_TOKENS=1800–2200`。这不会启用规则稿兜底，任务拆解仍由 Qwen 生成；取舍是网络偶发失败和一次结构校验失败时更容易直接返回 `GENERATION_FAILED`，以及 `max_tokens` 过低时可能截断 JSON。若失败率升高，优先恢复 `QWEN_MAX_TOKENS`，再恢复 `DEMO_LLM_CORRECTION`。

对比效果时可查看 `DemoGenerationMetadata.timings.plannerMs` 与容器日志中的结构化事件。

> 注意：空字符串环境变量会按“未设置”处理，避免 `QWEN_MODEL=` 覆盖默认模型导致 DashScope 返回 `you must provide a model parameter`。

## 3. 调用链路

1. **钉钉主链路**：`src/dingtalk-bot.ts` 调 `runOrchestrator`，由 `QwenCompatibleClient.callWithTools` 驱动 ReAct（tool_calls 循环）生成最终 `message + draft`。
2. **工具循环**：`callWithTools` 默认最多 6 轮；每轮都可继续使用工具，直到模型不再返回 `tool_calls`（不会在“最后一轮”被代码强制关工具）。
3. **prompt 版本**：当前 `QWEN_PLANNER_PROMPT_VERSION` 为 `orchestrator-agent-v5.14`（见 `src/agent/demo/qwen-prompt.ts`）；`runOrchestrator` 使用 `buildQwenPlannerSystemPrompt`，`generateStructuredPlan`（demo/eval）使用 `buildLegacyDemoPlannerSystemPrompt`，二者解耦。
4. **`save_draft` 行为**：当前偏“保存优先”，主要做 `coerceLlmPlanPayload` 归一化，不再依赖强门禁去阻断模型保存。
5. **会话记忆**：`knownFacts` 通过 `list_known_facts` / `update_known_facts` 在同会话内持续累积，`conversationHistory` 参与后续轮次上下文。
6. **输出补齐**：钉钉端拿到 `draft` 后会补充结构化字段表（含 `feedbackFrequency`），避免模型自由 Markdown 漏字段。
7. **可观测**：主链路关注 `orchestrator_done`、assignment 事件与 `data/plans` 快照；`createTaskPlanningDemo` 的 `DemoGenerationMetadata`/JSONL 主要用于 demo/eval 路径。

> 说明：`createTaskPlanningDemo` 仍保留在 `src/agent/demo/pipeline.ts`，用于 CLI demo/eval 与历史兼容，不是钉钉现网主路径。

## 4. 承接指派阶段的 LLM 调用

启用 `ASSIGNMENT_PHASE_ENABLED=1` 后，钉钉主链路在同一次 orchestrator 输出中追加分配建议；`runAssignmentRecommendation` 仍保留给测试 / 独立调用路径。

### 现网钉钉主路径（light-assignment）

- orchestrator 在 ReAct loop 内自主调用 `search_employees`（默认精简画像，按本部门优先）+ **`get_employee_details`**（按需拉完整 cases / background），并把分配结果作为 `assignment` JSON 一起输出；**若用户本轮仅为「主管显式点将」**（见 `qwen-prompt.ts`「主管显式指派纪律」），则仅允许一次 `search_employees(name=…)` 定人，**不得**再调 `get_employee_details` / `search_similar_plans` / `prepare_publish_task`。
- `dingtalk-bot` 通过 `extractLightAssignment` 做轻量 schema 校验后，将「分配建议」段落拼入同一条回复 Markdown。
- 不再触发第二次独立 LLM 调用；token 增量主要体现在 orchestrator 多出的一两轮工具回合，而非一次完整对话。

### `runAssignmentRecommendation`（备用 / 测试链路）

- **多轮 function calling**：暴露 `search_employees` + **`get_employee_details`**，模型先列候选再拉完整画像写 rationale；prompt 版本 **`assignment-recommender-agent-v0.3.1`**（主管显式指定时可跳过 `get_employee_details`，见 `assignment-prompt.ts`）。
- **Token 消耗**：完整跑一次额外约 **10K–15K tokens**（含 prompt、压缩画像与 function call 往返）。
- **自纠正重试**：Schema 校验失败时 **1 轮重试**；若仍失败放弃本轮推荐。
- 主链路当前不调用该函数；如需恢复独立异步推送，需显式接回 `dingtalk-bot` 并处理与 light-assignment 的优先级。

## 5. 风险控制（规划）

- Token 与超时：模型策略统一裁剪。
- 重试：`QWEN_MAX_RETRIES`（HTTP 层可带退避，见 `qwen-compatible-client`）。
- 可观测：每次 planner 调用 `InferenceTrace`；`createTaskPlanningDemo` 汇总 **`traces[]`**、**分段 `timings`**；成功草案可打 **`logStructured`** JSON 行。
- 审计：`requestId/model/tokens/latency/errorCode`；另见 **Demo JSONL**（`AUDIT_DEMO_JSONL_PATH`）与 Harness **`AUDIT_SINK=file`**（部署文档）。
- 密钥轮换：泄露须即刻在控制台作废 Key。

## 6. 评测方式

`npm run demo:eval` 输出：

- `draftReadyCases` / `needsMoreInfoCases` / `generationFailedCases`
- `avgTotalTokens` / `p95LatencyMs`

`npm run demo:scenarios` 会运行 **十余个**端到端冒烟场景（质量 / 研发 / 信息不足 / 更长现实描述等），打印每场景 JSON 摘要与最终 **`summary.tallies`**。单次运行耗时可数分钟量级，需在 `.env` 配置有效 `QWEN_API_KEY`。

## 7. 分期落地

- P0：仅 LLM 主路径 + 规则校验 + 严模式失败语义。（已具备）
- P1：**Trace / 分段耗时 / JSONL 审计 / 会话与限速 / Plan 快照 / PII 脱敏 / 一致性 warnings**。（工程已落地，见 `docs/harness-next-optimizations.md`）
- P2：黄金样本回归集与模板/提示词版本治理（持续）。

