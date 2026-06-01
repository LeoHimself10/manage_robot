# Eval Report Schema v1

统一离线 eval 产出格式（`eval-report-v1`），供 CI artifact、eval-history 与 Admin 运营看板读取。

## 顶层字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `schemaVersion` | `"eval-report-v1"` | 固定 |
| `runId` | string? | 可选 UUID / timestamp id |
| `suite` | string | 如 `release`, `chains`, `spot`, `unit` |
| `startedAt` | ISO8601 | 开始时间 |
| `finishedAt` | ISO8601 | 结束时间 |
| `allOk` | boolean | 全部 stage 通过 |
| `criticalOk` | boolean? | critical stage 通过（release 用） |
| `parityEnv` | string | `formatEvalProductionParitySummary()` 快照 |
| `stages[]` | EvalReportStage | 分阶段结果 |
| `dimensions{}` | 0–1 分数 | 六维 rubric 聚合（可选） |
| `passed` / `total` | number? | turn/scenario 计数 |
| `artifacts{}` | object | 嵌套子 suite summary 引用 |
| `meta{}` | object | 自由扩展 |

## EvalReportStage

```json
{
  "id": "chains-core",
  "label": "Core chains (28 turn)",
  "ok": true,
  "exitCode": 0,
  "durationMs": 1234567,
  "critical": true,
  "note": "optional"
}
```

## dimensions 映射

| 维度 | 来源断言 |
|------|----------|
| `task_completion` | publishOk, assignmentCoverage, 假指派 |
| `trajectory` | max_turns, toolCalls |
| `grounding` | read_url, 外链引导 |
| `hygiene` | eval-assistant-quality |
| `efficiency` | loopMs, tokens |
| `business_outcome` | （在线 / task_events，离线通常省略） |

## 输出路径

- 默认：`.eval-{suite}/eval-summary.json`
- 覆盖：`EVAL_DATA_DIR=/path`

## 写入 API

```ts
import { writeEvalReport } from "../scripts/eval-report";
writeEvalReport("release", { suite: "release", startedAt, allOk, stages, ... });
```
