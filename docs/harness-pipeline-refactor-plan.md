# Harness Pipeline 重构计划

> **状态（2026-05-08）**  
> 本文所述「薄 `llmPlanner`（仅 `rawJson` + `trace`）、`pipeline` 单点 `coerce → validate →` 可选**一轮结构自纠正** → `gate` → 渲染」**已在 `main` 落地**。请以 `src/agent/demo/pipeline.ts`、`src/agent/demo/qwen-planner.ts`、`src/agent/demo/qwen-compatible-client.ts` 为准；下文保留为设计考古与比对，**勿当作待办清单逐项执行**。

## 背景

当前 plan generation pipeline 存在六个结构性问题：

1. **双重 coerce+validate**：`qwen-planner.ts` 和 `pipeline.ts` 各做一遍，职责边界模糊
2. **无自纠正循环**：validate 失败直接抛异常，不利用 LLM 的修复能力
3. **NEEDS_MORE_INFO 跳过 validate**：先检查 `needsMoreInfoFromLlmPayload`，再 validate，导致 LOW confidence 场景残缺的 tasks 结构不被校验
4. **coerce 有残留语义补丁**：rationale 为空时自动补文案、title 为空时自动补 "任务 N"、domain 无法识别默认 QUALITY
5. **重试无退避**：盲重试，简单 for 循环无延迟无 jitter
6. **无 traceId**：请求链路不可追踪

## 目标

planner 变薄（只返 raw JSON + trace），pipeline 统一做 coerce → validate → correct → gate，coerce 退化为纯结构归一化。

---

## 当前数据流

```
dingtalk-bot.ts
  -> pipeline.ts: createTaskPlanningDemo()
      -> checkInputQuality()
      -> llmPlanner(request) = runQwenPlanner()
          -> qwen-planner.ts: runQwenPlanner()
              -> client.generateStructuredPlan()
              -> coerceLlmPlanPayload()     <-- 第一次 coerce
              -> validateLlmPlanPayload()    <-- 第一次 validate (allowEmptyTasks)
              -> ensureCapaDisclaimer()
              -> return LlmPlanResult (已清洗)
          -> pipeline.ts (收到 LlmPlanResult)
              -> coerceLlmPlanPayload()      <-- 第二次 coerce (空转)
              -> needsMoreInfoFromLlmPayload()  <-- 在 validate 之前
              -> validateLlmPlanPayload()    <-- 第二次 validate (永远通过)
              -> validateDemoGate()
              -> validateGateSelfCheckConsistency()
              -> renderPlanDraftMarkdown()
```

## 目标数据流

```
dingtalk-bot.ts
  -> pipeline.ts: createTaskPlanningDemo()
      -> checkInputQuality()                [兜底：空文本检测]
      -> llmPlanner(request) = runQwenPlanner()
          -> qwen-planner.ts: runQwenPlanner()  [薄封装]
              -> client.generateStructuredPlan()
              -> return { rawJson, trace }  [不再 coerce/validate]
          -> pipeline.ts (收到 LlmPlannerResponse)
              -> coerceLlmPlanPayload(rawJson)   [仅一次，纯结构归一化]
              -> needsMoreInfo?                  
              -> validateLlmPlanPayload()         [allowEmptyTasks 按需]
              -> [若失败] 自纠正 1 轮
              -> [若仍失败] GENERATION_FAILED
              -> [若 needsMoreInfo] NEEDS_MORE_INFO  [validate 之后，结构已保证]
              -> validateDemoGate() + gateSelfCheck
              -> renderPlanDraftMarkdown()
```

---

## 改动步骤

### Step 1: 新增类型 (`src/agent/demo/llm-types.ts`)

建立新的 planner→pipeline 契约，不动现有行为。

```typescript
// 新增：planner 返回给 pipeline 的类型
export interface LlmPlannerResponse {
  rawJson: unknown;
  trace: InferenceTrace;
}

// 新增：自纠正上下文
export interface LlmCorrectionContext {
  previousRawJson: string;
  validationErrors: string[];
}

// 扩展：LlmPlannerRequest 增加可选字段
export interface LlmPlannerRequest {
  background: string;
  domainHint?: PlanDomain;
  traceId?: string;
  correction?: LlmCorrectionContext;
}

// 扩展：InferenceTrace 增加 traceId
export interface InferenceTrace {
  traceId?: string;
  requestId: string;
  model: string;
  tokenUsage: TokenUsage;
  latencyMs: number;
  errorCode?: string;
}
```

验证：`npx tsc --noEmit` 通过。

---

### Step 2: 指数退避 (`src/agent/demo/qwen-compatible-client.ts`)

在 `generateStructuredPlan` 的重试循环中加入 jittered exponential backoff。

新增 helper：

```typescript
function sleepWithJitter(attempt: number, baseMs = 200, capMs = 5000): Promise<void> {
  const exponential = Math.min(capMs, baseMs * Math.pow(2, attempt));
  const jittered = exponential * (0.75 + Math.random() * 0.5);
  return new Promise(resolve => setTimeout(resolve, jittered));
}
```

在 `generateStructuredPlan` 的 catch 块后、下次循环前插入 `await sleepWithJitter(attempt)`。

验证：retry 测试用 `maxRetries: 0` 不触发 backoff，或引入 `vi.useFakeTimers()`。

---

### Step 3: 删除 coerce 语义补丁 (`src/agent/demo/llm-schema.ts`)

coerce 只做结构归一化（trim、uppercase、数组包裹、alias 映射），不再发明缺失内容。

#### 3a. `normalizeDomain` — 删除 fallback

```typescript
// 改前：fallback 不存在时默认 QUALITY
function normalizeDomain(input: unknown, fallback?: PlanDomain): PlanDomain

// 改后：无法识别就原样返回，让 validate 报错
function normalizeDomain(input: unknown): PlanDomain {
  const normalized = asString(input).toUpperCase();
  if (normalized === "RD") return "RD";
  if (normalized === "QUALITY") return "QUALITY";
  return normalized as PlanDomain;
}
```

#### 3b. `normalizeConfidence` — 删除 MEDIUM fallback

```typescript
// 改后：无法识别就原样返回
function normalizeConfidence(input: unknown): ClassificationConfidence {
  const normalized = asString(input).toUpperCase() as ClassificationConfidence;
  if (classificationConfidenceValues.has(normalized)) return normalized;
  return normalized;
}
```

#### 3c. `normalizeClassification` — 删除 rationale 补丁 + else 分支

- `rationale.length > 0 ? rationale : ["模型返回分类缺少判断依据..."]` → 直接 `rationale`
- else 分支（分类对象完全缺失时）改为返回空骨架，让 validate 报错

#### 3d. `normalizeTask` — 删除语义默认值

- title：不补 `"任务 ${index + 1}"`，保持空字符串
- actions：不补 `[objective]`
- deliverables：不补 `["${title}交付记录"]`
- completionCriteria：不补 `["${title}已完成并可复核"]`
- feedbackFrequency：不补 `"每日反馈"`
- dueAt：不补 `"T+2 工作日"`

#### 3e. `coerceLlmPlanPayload` — 删除 context 参数

```typescript
// 改前
export function coerceLlmPlanPayload(
  payload: unknown,
  context?: { domainHint?: PlanDomain; background?: string }
): LlmPlanPayload

// 改后
export function coerceLlmPlanPayload(payload: unknown): LlmPlanPayload
```

#### 3f. 删除 `inferSubtype` 函数

coerce 不再做 subtype 推断。LLM 不输出 subtype → validate 报错。

---

### Step 4: 剥离 planner 的 coerce+validate (`src/agent/demo/qwen-planner.ts`)

`runQwenPlanner` 变成 thin wrapper。

**删除的 import：**

- `coerceLlmPlanPayload`, `needsMoreInfoFromLlmPayload`, `validateLlmPlanPayload`
- `CapaAdvisory`, `CAPA_DISCLAIMER`
- `ensureCapaDisclaimer` 函数

**改动后的核心逻辑：**

```typescript
export async function runQwenPlanner(
  request: LlmPlannerRequest,
  config: QwenPlannerConfig
): Promise<LlmPlannerResponse> {
  const client = new QwenCompatibleClient(config);
  const response = await client.generateStructuredPlan(request);
  return {
    rawJson: response.payload,
    trace: response.trace,
  };
}
```

保留 `loadQwenPlannerConfigFromEnv` 和 `buildFallbackTrace`。

---

### Step 5: 支持 correction prompt (`src/agent/demo/qwen-prompt.ts`)

当 pipeline 传入 `correction` 时，user prompt 追加错误信息和上一次的 JSON。

```typescript
if (request.correction) {
  lines.push(
    "",
    "你上一次的 JSON 输出存在以下结构验证问题，请修正后重新输出完整 JSON：",
    "",
    "## 结构验证错误",
    ...request.correction.validationErrors.map(e => `- ${e}`),
    "",
    "## 上一次的输出",
    "```json",
    request.correction.previousRawJson,
    "```",
    "",
    "请只修正上述结构问题，保持其他内容不变。不要改变已有的正确字段值。"
  );
}
```

---

### Step 6: pipeline 核心重构 (`src/agent/demo/pipeline.ts`)

#### 6a. 更新类型

- `TaskPlanningDemoOptions.llmPlanner` 返回类型从 `LlmPlanResult` 改为 `LlmPlannerResponse`
- 新增 `CAPA_DISCLAIMER` import

#### 6b. 生成 traceId

```typescript
const traceId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
```

#### 6c. 核心流程（替换现有 line 94-166）

```typescript
// 1. 调 LLM
let llmRaw = await options.llmPlanner({
  background: request.background,
  domainHint: request.domainHint,
  traceId,
});

// 2. Coerce + validate
let normalized = coerceLlmPlanPayload(llmRaw.rawJson);
let needsMoreInfo = needsMoreInfoFromLlmPayload(normalized);
let validation = validateLlmPlanPayload(normalized, {
  allowEmptyTasks: needsMoreInfo,
});

// 3. 自纠正（1 轮）
let correctionUsed = false;
if (!validation.valid) {
  correctionUsed = true;
  llmRaw = await options.llmPlanner({
    background: request.background,
    domainHint: request.domainHint,
    traceId,
    correction: {
      previousRawJson: JSON.stringify(llmRaw.rawJson),
      validationErrors: validation.errors,
    },
  });
  normalized = coerceLlmPlanPayload(llmRaw.rawJson);
  needsMoreInfo = needsMoreInfoFromLlmPayload(normalized);
  validation = validateLlmPlanPayload(normalized, {
    allowEmptyTasks: needsMoreInfo,
  });
}

// 4. 仍失败 → GENERATION_FAILED
if (!validation.valid) {
  throw new Error(validation.errors.join("; "));
}

// 5. NEEDS_MORE_INFO（validate 之后）
if (needsMoreInfo) {
  return {
    status: "NEEDS_MORE_INFO",
    questions: normalized.openQuestions,
    missingFields: normalized.classification.missingInformation,
  };
}

// 6. 领域处理 + 门禁 + 渲染（现有逻辑）
const classification = normalized.classification;
const capaAdvisory =
  classification.domain === "QUALITY"
    ? ensureCapaDisclaimer(normalized.capaAdvisory)
    : undefined;
const tasks = normalized.tasks;
const openQuestions = [...normalized.openQuestions];

const gate = validateDemoGate(tasks);
validateGateSelfCheckConsistency(normalized.gateSelfCheck, gate);
// ...后续渲染逻辑不变
```

#### 6d. 新增 `ensureCapaDisclaimer` helper（从 qwen-planner.ts 移入）

---

### Step 7: 更新测试

#### 7a. `tests/agent/demo/llm-fixtures.ts` — 新增 helper

```typescript
export function rawLlmResponse(overrides: Partial<LlmPlanPayload> = {}): LlmPlannerResponse {
  const payload = { ...qualityLlmResult(), ...overrides };
  const { trace, ...rawJson } = payload;
  return { rawJson, trace: trace! };
}
```

#### 7b. `tests/agent/demo/llm-schema.test.ts` — 适配新签名

- 所有 `coerceLlmPlanPayload(payload, context)` → `coerceLlmPlanPayload(payload)`
- 删除 context 参数传递
- rationale 测试断言调整：coerce 不再补默认文案

#### 7c. `tests/agent/demo/pipeline.test.ts` — 适配新返回类型

- 所有 `llmPlanner` mock 从返回 `LlmPlanResult` 改为 `LlmPlannerResponse`（用 `rawLlmResponse()` 包装）
- "fails when llm payload is invalid" 测试：mock 会被调用 2 次（自纠正），去掉 `toHaveBeenCalledTimes(1)` 断言
- 其他测试期望值不变

#### 7d. `tests/agent/demo/qwen-compatible-client.test.ts` — 适配字段名

- `result.payload.xxx` → `(result.rawJson as any).xxx`

---

### Step 8: 验证

```bash
npx tsc --noEmit       # 零错误
npx vitest run         # 全部通过
npx tsx src/demo.ts    # 端到端验证（需要 QWEN_API_KEY）
```

---

## 实施顺序

按依赖关系分 3 个 commit：

### Commit 1: 类型 + 退避 + coerce 清理

- Step 1（llm-types.ts 新类型）
- Step 2（qwen-compatible-client.ts 退避）
- Step 3（llm-schema.ts 去语义补丁）
- Step 7a + 7b + 7d（测试适配）

### Commit 2: planner 剥离 + prompt + pipeline 重构

- Step 4（qwen-planner.ts 变薄）
- Step 5（qwen-prompt.ts 支持 correction）
- Step 6（pipeline.ts 核心重构）
- Step 7c（pipeline 测试适配）

### Commit 3: 验证

- Step 8（全量测试 + tsc）

---

## 不动的部分（历史表述；以当前代码为准）

- `dingtalk-bot.ts`：历史上无需随本重构改动；**后续**已增加会话摘要、限流等（见 `docs/harness-next-optimizations.md`）。
- `gate.ts` / `policies.ts` / `markdown-renderer.ts`：**后续**已扩展 `warnings`、一致性提示渲染等。
- `input-qc.ts`：**后续**已增加 `INPUT_MAX_CHARS` 等护栏。
- harness 层：`bootstrap` 已支持 `AUDIT_SINK=file` 等，编排骨架仍以 `orchestrator` 为准。
- Domain 类型：不动（除非另有 PRD 变更）。

---

## 风险与注意事项

1. **coerce 不再补 title 等默认值后**：LLM 输出缺失字段的 task 会在 validate 阶段报错而不是静默通过，需确认 prompt 对字段完整性的约束足够强
2. **自纠正最多 1 轮**：不设无限循环，防止延迟失控和 token 浪费
3. `**inferSubtype` 删除后**：LLM 必须总是输出合法 subtype，不再有代码兜底。prompt 中的 subtype 约束需要足够明确
4. **退避用 `setTimeout`**：测试中使用 `vi.useFakeTimers()` 或确保 retry 测试用 `maxRetries: 0`

