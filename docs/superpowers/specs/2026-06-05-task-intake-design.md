# 任务快录入库（task-intake）设计

> **快照**：2026-06-05 初稿；**2026-06-09** 已落地 v1.2（AI 多父任务分组、追加已有、描述/背景自动填充）。**现网口径以 `docs/task-intake.md` 为准**，本文保留设计脉络与 FR 追溯。

## 背景与目标

老板要求：**把已经拆好的任务通过工作台快速录入正式任务库**。现有主链路 orchestrator 倾向于**重新拆解 / 追问**；会议入库（meeting-import）从乱纪要抽取、归并父任务——老板**不想要**重拆。

本功能提供并列向导 `任务快录入库`：粘贴已拆清单 → LLM **忠实映射** → **AI 建议归属**（已有父任务 / 多个新建父任务 / 手动未分配）→ 分组预览微调 → 发布或追加。

### FR 验收

| FR | 说明 | 状态 |
|----|------|------|
| FR-TI-1 | 任何主管可用，**不挂 Portfolio 门禁** | ✅ |
| FR-TI-2 | 结构化 N 进 N 出，禁止增删/合并/润色标题 | ✅ |
| FR-TI-3 | 项目归档可选（Portfolio 有下拉） | ✅ |
| FR-TI-4 | 新建父任务：全负责人→发布；缺负责人→主线程暂存草案 | ✅ |
| FR-TI-5 | meeting-import **零改动** | ✅ |
| FR-TI-6 | AI 建议追加到已有父任务（confidence ≥ 0.6） | ✅ v1.2 |
| FR-TI-7 | 未匹配子任务按语义聚类为**多个**新建父任务组（标题+描述） | ✅ v1.2 |
| FR-TI-8 | 单新建组缺组描述时回退 `parentDescription` | ✅ v1.2 |
| FR-TI-9 | 负责人自报截止：支持 `dueMode=self` + `dueExpectation`，员工承接时自报 `proposedDueAt` 立即生效，主管可强制改期 | ✅ v1.2+ |

## 架构与数据流（v1.2）

```
[粘贴 + 可选父标题提示]
        │  POST /api/workbench/manager/task-intake/preview
        ▼
structure-input.ts  →  parentTitle, parentDescription, subtasks[]
        ▼
suggest-targets.ts  →  每条：targetPlanId | newGroupId+title+description | 未分配
        ▼
resolve-assignees.ts  →  preview rows + assigneeUserId / needsConfirm
        ▼
applyNewGroupDescriptionFallback（API 层，单组兜底）
        ▼
[步骤 2 分组 UI：新建父任务(可多组) / 追加已有 / 未分配]
        │  POST .../commit（按新建组）
        │  POST .../append（按追加组）
        ▼
commit-task-intake.ts / appendTaskIntake
```

## 模块与文件

| 文件 | 职责 |
|------|------|
| `structure-input.ts` | 忠实结构化（LLM + 行切分 fallback） |
| `suggest-targets.ts` | AI 归属与多父任务分组 |
| `resolve-assignees.ts` | 预览行合并建议 + 姓名解析 |
| `commit-task-intake.ts` | 发布 / 暂存 / 追加 |
| `task-intake-api.ts` | preview / commit / append |
| `manager-task-intake-page.ts` | 分组向导 UI |

完整索引见 `docs/task-intake.md`。

## 非目标（仍不做）

- 钉钉对话入口（仅工作台向导）。
- 与 meeting-import 合并发布管道（独立实现，后续可抽共享层）。
- orchestrator 式 WBS 重拆。

## 访问控制

- 页面/API：`requireSession(manager)`，**无** `requirePortfolioManager`。
- `TASK_INTAKE_ENABLED`（默认开）；`0` 时隐藏入口。

## 测试

- `tests/agent/task-intake/*.test.ts`
- `tests/web/task-intake.test.ts`

## 后续

`commit-task-intake` 与 `commit-meeting-import` 稳定后，抽 `src/agent/task-publish/publish-grouped-rows.ts` 共享，并以 meeting-import eval 防回归。
