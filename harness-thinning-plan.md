# Harness 减薄建议：删除 LLM 已承担的重叠校验

## 判断原则

prompt v2.11 已经让 LLM 承担了：
- 意图分类（NON_TASK / TASK_GAP）与 **`responseIntent`**（聊天 / 追问 / 讨论 / 出稿 / 修订 / 重置等）
- gate 自检（gateSelfCheck：四必填字段逐 task 检查）
- 自然回复（**`assistantMessage`**）与结构化反问（**`openQuestions`**；不再把自然回复仅塞进 openQuestions）

代码如果再把这三件事做一遍，就是"不信任 LLM"的冗余层。应该删。

---

## 具体改动

### 1. 删除 `consistency.ts`，逻辑移入 prompt

**文件：** `src/agent/demo/consistency.ts`（115 行，删除）

**原因：** 三个检查（依赖存在性、循环依赖、时间顺序）LLM 可以在 gateSelfCheck 中自己做完。prompt 加 3 条指令即可替代。

**prompt 改动**（`qwen-prompt.ts` line 27，扩展 gateSelfCheck 指令）：

```
生成任务后执行 gateSelfCheck：
- 对每个 task 检查 deliverables、completionCriteria、timeNode.dueAt、feedbackFrequency 四项
- 检查 dependencyTaskIds 引用的 taskId 是否都存在于当前 tasks 列表中
- 检查是否存在循环依赖（A→B→A）
- 若 tasks 为空，gateSelfCheck.passed=true 且 missingByTask=[]
- 在 missingByTask 中汇总所有未通过的任务及具体缺失字段和一致性警告
```

---

### 2. pipeline 删除 gate 代码重算

**文件：** `src/agent/demo/pipeline.ts`（-60 行）

**删除：**
- `import { collectGateSelfCheckAlignmentWarnings, collectTaskConsistencyWarnings } from "./consistency"`
- `import { DemoGateResult, validateDemoGate } from "./gate"`
- `validateGateSelfCheckConsistency()` 函数定义
- 整段 gate 重算 + warnings 合并逻辑

**改为：** gate 结果直接取 LLM 的 `gateSelfCheck`

```typescript
// 改前（line 249-264）：
const gateBase = validateDemoGate(tasks);
validateGateSelfCheckConsistency(normalized.gateSelfCheck, gateBase);
const gate: DemoGateResult = {
  ...gateBase,
  warnings: [
    ...gateBase.warnings,
    ...collectTaskConsistencyWarnings(tasks),
    ...collectGateSelfCheckAlignmentWarnings(normalized.gateSelfCheck, gateBase),
  ],
};

// 改后：
const gate = normalized.gateSelfCheck ?? { passed: true, missingByTask: [] };
```

---

### 3. markdown-renderer 删除 warnings 段

**文件：** `src/agent/demo/markdown-renderer.ts`（-25 行）

**改动：**
- `gate` 参数类型从 `DemoGateResult` 改为 `LlmGateSelfCheck`
- 删除 `renderGateWarningsSection()` 函数（warnings 现在由 LLM 在 gateSelfCheck.missingByTask 中直接产出）
- `renderTaskTable` 中 gate 不通过的 ⚠ 前缀保留（逻辑不变）

---

### 4. gate.ts 保留但精简

**文件：** `src/agent/demo/gate.ts`

- 保留 `findDispatchGateMissingFields`：`policies.ts` 的派发门禁依赖它，职责独立
- `validateDemoGate` 不再被 pipeline 调用，可标记 `@deprecated` 或删除

---

### 5. 测试适配

- 删除 `tests/agent/demo/consistency.test.ts`（58 行）
- `tests/agent/demo/pipeline.test.ts`：gate 断言从 `result.gate.passed` 改为检查 `gateSelfCheck`
- `tests/agent/demo/output.test.ts`：gate 参数适配

---

## 改动汇总

| 文件 | 动作 | 行数 |
|------|------|------|
| `src/agent/demo/consistency.ts` | 删除 | -115 |
| `src/agent/demo/qwen-prompt.ts` | gateSelfCheck 指令扩展 | +4 |
| `src/agent/demo/pipeline.ts` | 删除 gate 重算 + consistency + 交叉校验 | -60 |
| `src/agent/demo/markdown-renderer.ts` | 删除 warnings 段，gate 参数改类型 | -25 |
| `tests/agent/demo/consistency.test.ts` | 删除 | -58 |
| `tests/agent/demo/pipeline.test.ts` | gate 断言适配 | -15 |
| `tests/agent/demo/output.test.ts` | gate 参数适配 | -5 |
| **合计** | | **-274 行** |

---

## 保住不动的层

| 层 | 为什么不动 |
|---|---|
| `llm-schema.ts` coerce+validate | JSON 格式校验是 LLM 替代不了的硬防线 |
| 自纠正循环 | LLM 犯错时帮它修正，这是 harness 最核心的价值 |
| `content-filter.ts` | 安全底线 |
| `audit-file-sink.ts` + `plan-store.ts` | 生产运维基础 |
| `session-store.ts` | 多轮对话记忆 |
| SSE 流式 | 用户体验 |
| `findDispatchGateMissingFields` + `policies.ts` | harness orchestrator 的派发门禁，与 pipeline 门禁职责不同 |

---

## 风险与回退

如果 LLM 的 gateSelfCheck 不够稳定（说 passed 但实际缺失字段），回退方案：
- 恢复 `validateDemoGate` 调用，但降级为 warn-only（不阻塞，只在 markdown 中追加提示）
- 不恢复 consistency.ts（prompt 一致性检查通常够用）
